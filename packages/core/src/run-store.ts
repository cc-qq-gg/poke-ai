import { createPermissionToken } from './permissions'
import { compactStoredTurnOutput, persistPokeRun, schedulePersistPokeRun } from './run-history'

// Reasoning can run long; the panel only needs its recent part.
const maxThinkingLength = 24000

function compactThinking(thinking: string) {
  return thinking.length > maxThinkingLength * 1.25 ? `…${thinking.slice(thinking.length - maxThinkingLength)}` : thinking
}

/** Compact with slack, so a streaming turn is not re-sliced on every delta. */
function compactAccumulatedOutput(output: string) {
  return output.length > maxAccumulatedOutputLength ? compactStoredTurnOutput(output) : output
}
import { getDisplayPath } from './source'
import type { PokeAgentPermissionMode, PokeAgentSessionMode, PokeEvent, PokeRun, PokeRunTurn, ResolvedPokeAgentProvider } from './types'
import type { ServerResponse } from 'http'

const maxBufferedPokeEvents = 800
const maxAccumulatedOutputLength = 80000

export const pokeRuns = new Map<string, PokeRun>()

/**
 * Bumped whenever the task list changes shape (run added or removed, turn
 * started or settled). Other tabs poll the list with it and get a cheap
 * "unchanged" answer most of the time.
 */
let pokeRunsVersion = 1

export function getPokeRunsVersion() {
  return pokeRunsVersion
}

export function bumpPokeRunsVersion() {
  pokeRunsVersion += 1
}

export type PokeTurnMetadata = {
  agentPrompt: string
  fileName: string
  lineNumber: number
  permissionMode?: PokeAgentPermissionMode
  prompt: string
  resumed: boolean
  sourceName: string
  sourcePath: string
}

export function sendPokeEvent(res: ServerResponse, event: PokeEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function getCurrentTurn(run: PokeRun) {
  return run.turns[run.turns.length - 1]
}

function createTurn(index: number, providerLabel: string, metadata: PokeTurnMetadata): PokeRunTurn {
  return {
    agentPrompt: metadata.agentPrompt,
    completed: false,
    createdAt: Date.now(),
    index,
    lineNumber: metadata.lineNumber,
    output: '',
    permissionMode: metadata.permissionMode,
    prompt: metadata.prompt,
    resumed: metadata.resumed,
    sourceName: metadata.sourceName,
    sourcePath: metadata.sourcePath,
    status: 'starting',
    statusMessage: `${providerLabel} starting`,
  }
}

/**
 * Mirror the active turn onto the run so existing run-level consumers (task
 * list, dock badge) keep working without knowing about turns.
 */
function syncRunFromCurrentTurn(run: PokeRun) {
  const turn = getCurrentTurn(run)
  if (!turn) {
    return
  }

  run.agentPrompt = turn.agentPrompt
  run.code = turn.code
  run.completed = turn.completed
  run.fileName = turn.sourcePath
  run.lineNumber = turn.lineNumber
  run.sourceName = turn.sourceName
  run.sourcePath = turn.sourcePath
  run.status = turn.status
  run.statusMessage = turn.statusMessage
}

export function appendPokeEvent(runId: string, event: PokeEvent) {
  const run = pokeRuns.get(runId)
  if (!run) {
    return
  }

  const turn = getCurrentTurn(run)
  const turnIndex = turn?.index ?? 0

  if (event.type === 'output' && event.stream === 'stdout') {
    run.sessionStarted = true
  }

  if (turn) {
    if (event.type === 'status' || event.type === 'heartbeat' || event.type === 'output') {
      turn.status = turn.completed ? turn.status : 'running'
      if (event.type !== 'output' && event.message) {
        turn.statusMessage = event.message
      }
    }

    if (event.type === 'error') {
      turn.completed = true
      turn.completedAt = Date.now()
      turn.status = 'failed'
      turn.statusMessage = event.message || turn.statusMessage
    }

    if (event.type === 'done') {
      turn.changedFiles = event.changedFiles
      turn.code = event.code
      turn.completed = true
      turn.completedAt = Date.now()
      if (run.stopRequested) {
        // A stopped turn exits on a signal; report the user's action, not the exit code.
        run.stopRequested = false
        turn.stopped = true
        turn.status = 'failed'
        turn.statusMessage = 'stopped by user'
      } else {
        turn.status = event.code === 0 ? 'done' : 'failed'
        turn.statusMessage = event.code === 0 ? `${run.providerLabel} done` : `${run.providerLabel} exited with code=${event.code ?? 'null'}`
      }
    }

    syncRunFromCurrentTurn(run)
  }

  run.eventSeq += 1
  const storedEvent: PokeEvent = { ...event, seq: run.eventSeq, turn: event.turn ?? turnIndex }
  if (turn && (event.type === 'done' || event.type === 'error')) {
    storedEvent.completedAt = turn.completedAt
    storedEvent.stopped = turn.stopped
  }

  run.events.push(storedEvent)
  if (run.events.length > maxBufferedPokeEvents) {
    const droppedCount = run.events.length - maxBufferedPokeEvents
    run.events.splice(0, droppedCount)
    run.droppedEventCount += droppedCount
  }

  for (const subscriber of run.subscribers) {
    sendPokeEvent(subscriber, storedEvent)
  }

  if (event.type !== 'heartbeat') {
    run.updatedAt = Date.now()
  }

  if (turn && event.type === 'thinking') {
    const now = Date.now()
    turn.thinkingSince ??= now
    turn.thinking = compactThinking(`${turn.thinking ?? ''}${event.message ?? ''}`)
    turn.status = turn.completed ? turn.status : 'running'
  } else if (turn?.thinkingSince && (event.type === 'output' || event.type === 'done' || event.type === 'error')) {
    // The answer (or a tool call, or the end) closes the thinking stretch.
    turn.thinkingMs = (turn.thinkingMs ?? 0) + (Date.now() - turn.thinkingSince)
    turn.thinkingSince = undefined
  }

  if (event.type === 'output' || event.type === 'error') {
    // Each turn accumulates its own text. The event buffer is capped and only
    // serves SSE replay; a streamed reply is hundreds of tiny delta events, so
    // deriving output from it would silently lose the start of long replies.
    const outputTurn = run.turns.find((candidate) => candidate.index === storedEvent.turn) ?? turn
    if (outputTurn) {
      const prefix = event.stream === 'stderr' ? '[stderr] ' : ''
      const piece = event.type === 'error' ? `\n[poke] ${event.message || 'Agent failed'}\n` : `${prefix}${event.message || ''}`
      outputTurn.output = compactAccumulatedOutput(`${outputTurn.output ?? ''}${piece}`)
    }
  }

  if (event.type === 'done' || event.type === 'error' || event.type === 'turn') {
    bumpPokeRunsVersion()
    persistPokeRun(runId)
  } else if (event.type === 'output' || event.type === 'thinking') {
    schedulePersistPokeRun(runId)
  }
}

export function createPokeRun(
  runId: string,
  root: string,
  logPath: string,
  provider: Pick<ResolvedPokeAgentProvider, 'id' | 'label'>,
  sessionMode: PokeAgentSessionMode,
  sessionId: string | undefined,
  metadata: PokeTurnMetadata,
) {
  const run: PokeRun = {
    completed: false,
    createdAt: Date.now(),
    droppedEventCount: 0,
    eventSeq: 0,
    events: [],
    fileName: metadata.fileName,
    lineNumber: metadata.lineNumber,
    logPath,
    prompt: metadata.prompt,
    providerId: provider.id,
    providerLabel: provider.label,
    alwaysAllowedTools: new Set(),
    pendingPermissions: new Map(),
    permissionToken: createPermissionToken(),
    root,
    sessionId,
    sessionMode,
    sessionStarted: false,
    sourceName: metadata.sourceName,
    sourcePath: metadata.sourcePath,
    status: 'starting',
    statusMessage: `${provider.label} starting`,
    subscribers: new Set(),
    turns: [createTurn(0, provider.label, metadata)],
    updatedAt: Date.now(),
  }

  syncRunFromCurrentTurn(run)
  pokeRuns.set(runId, run)
  bumpPokeRunsVersion()
  persistPokeRun(runId)
  return run
}

export function appendPokeRunTurn(runId: string, run: PokeRun, metadata: PokeTurnMetadata) {
  const turn = createTurn(run.turns.length, run.providerLabel, metadata)
  run.turns.push(turn)
  run.child = undefined
  run.code = undefined
  run.signal = undefined
  syncRunFromCurrentTurn(run)

  // A `turn` event is the boundary marker the panel splits output on.
  appendPokeEvent(runId, { message: metadata.prompt, turn: turn.index, type: 'turn' })

  return turn
}

export function setPokeRunSessionId(runId: string, sessionId: string) {
  const run = pokeRuns.get(runId)
  if (!run || !sessionId || run.sessionId === sessionId) {
    return
  }

  run.sessionId = sessionId
  bumpPokeRunsVersion()
  persistPokeRun(runId)
}

/**
 * Why this run cannot take another turn, as a panel message key (the panel
 * translates it, with `{provider}` filled in). Empty when it can.
 */
export type PokeResumeBlockedCode = '' | 'resume.noSession' | 'resume.notStarted' | 'resume.running' | 'resume.unsupported'

export function getPokeRunResumeBlockedCode(run: PokeRun): PokeResumeBlockedCode {
  if (run.sessionMode === 'none') {
    return 'resume.unsupported'
  }

  if (!run.completed) {
    return 'resume.running'
  }

  if (!run.sessionId) {
    return 'resume.noSession'
  }

  if (run.sessionMode === 'assign' && !run.sessionStarted) {
    return 'resume.notStarted'
  }

  return ''
}

export function getPokeTurnOutput(run: PokeRun, turnIndex: number) {
  return run.turns.find((candidate) => candidate.index === turnIndex)?.output ?? ''
}

/**
 * `detail` adds each turn's output and full agent prompt. The task list only
 * needs the light shape; a settled run's transcript is fetched when opened.
 */
/**
 * `file:line` for the panel, like the locations it builds from picked
 * elements, so "copy location" and "open in IDE" land on the right line.
 * Empty for conversations about the whole project.
 */
function toSourceLocation(sourcePath: string, lineNumber: number) {
  return sourcePath && lineNumber > 0 ? `${sourcePath}:${lineNumber}` : sourcePath
}

export function getPokeRunSummary(runId: string, run: PokeRun, root: string, detail = true) {
  const resumeBlockedCode = getPokeRunResumeBlockedCode(run)

  return {
    canResume: !resumeBlockedCode,
    code: run.code,
    completed: run.completed,
    createdAt: run.createdAt,
    detail,
    id: runId,
    interrupted: run.turns[run.turns.length - 1]?.interrupted === true,
    // Tool calls waiting for the user; small, so the light list carries them too.
    pendingPermissions: [...run.pendingPermissions.values()].map((pending) => pending.request),
    stopped: run.turns[run.turns.length - 1]?.stopped === true,
    lastSeq: run.eventSeq,
    logDisplayPath: getDisplayPath(run.logPath, root),
    logPath: run.logPath,
    pinnedAt: run.pinnedAt,
    providerId: run.providerId,
    providerLabel: run.providerLabel,
    resumeBlockedCode,
    sessionMode: run.sessionMode,
    signal: run.signal,
    sourceName: run.sourceName,
    sourcePath: toSourceLocation(run.sourcePath, run.lineNumber),
    status: run.status,
    statusMessage: run.statusMessage,
    turns: run.turns.map((turn) => ({
      ...(detail ? { agentPrompt: turn.agentPrompt, output: getPokeTurnOutput(run, turn.index), thinking: turn.thinking } : {}),
      // Patches can be large; the panel asks for one when the file is expanded.
      changedFiles: turn.changedFiles?.map(({ patch: _patch, ...file }) => file),
      code: turn.code,
      completed: turn.completed,
      completedAt: turn.completedAt,
      createdAt: turn.createdAt,
      index: turn.index,
      interrupted: turn.interrupted === true,
      permissionMode: turn.permissionMode,
      prompt: turn.prompt,
      resumed: turn.resumed,
      sourceName: turn.sourceName,
      sourcePath: toSourceLocation(turn.sourcePath, turn.lineNumber),
      status: turn.status,
      statusMessage: turn.statusMessage,
      stopped: turn.stopped === true,
      thinkingMs: turn.thinkingMs,
    })),
    updatedAt: run.updatedAt,
  }
}
