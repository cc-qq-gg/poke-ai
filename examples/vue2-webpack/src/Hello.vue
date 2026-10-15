<template>
  <p class="hello">Hello, {{ name }}!</p>
</template>

<script>
export default {
  name: 'Hello',
  props: {
    name: { type: String, default: '' },
  },
}
</script>
