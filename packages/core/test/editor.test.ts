import { describe, expect, it } from 'vitest'
import { getEditorArgs, getOpenInEditorCommand } from '../src/editor'

const QODER_BINARY = '/Applications/Qoder IDE.app/Contents/MacOS/Qoder'

describe('getEditorArgs — Qoder (VS Code fork)', () => {
  it('passes -r -g "file:line:column" to the Qoder app binary', () => {
    expect(getEditorArgs(QODER_BINARY, '/repo/src/views/demo.vue', 42, 7)).toEqual(['-r', '-g', '/repo/src/views/demo.vue:42:7'])
  })

  it('passes -r -g to a qoder CLI shim too', () => {
    expect(getEditorArgs('/usr/local/bin/qoder', '/repo/src/App.vue', 1, 1)).toEqual(['-r', '-g', '/repo/src/App.vue:1:1'])
  })
})

describe('getOpenInEditorCommand — Qoder on macOS', () => {
  it.skipIf(process.platform !== 'darwin')('routes through `open qoder://file/...:line:col`', () => {
    const command = getOpenInEditorCommand(QODER_BINARY, '/repo/src/views/demo.vue', 42, 7)
    expect(command.command).toBe('/usr/bin/open')
    expect(command.args).toEqual(['qoder://file/repo/src/views/demo.vue:42:7'])
  })
})
