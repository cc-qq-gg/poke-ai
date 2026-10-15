<template>
  <div class="app">
    <h1>Poke Vue 2 Playground</h1>
    <input v-model="keyword" placeholder="Search" />
    <button type="button" @click="count++">Count: {{ count }}</button>
    <ul>
      <li v-for="item in items" :key="item">{{ item }}</li>
    </ul>
    <Hello name="world" />
  </div>
</template>

<script>
import Hello from './Hello.vue'

export default {
  name: 'App',
  components: { Hello },
  data() {
    return {
      keyword: '',
      count: 0,
      items: ['alpha', 'beta', 'gamma'],
    }
  },
}
</script>

<style>
.app {
  font-family: system-ui, sans-serif;
  padding: 24px;
}
</style>
