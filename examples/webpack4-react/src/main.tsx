import * as React from 'react'
import * as ReactDOM from 'react-dom'
import './main.css'

function App() {
  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Poke</p>
        <h1 className="title">Webpack 4 + React 17 示例</h1>
        <p className="subtitle">
          这个示例使用 webpack 4 与 webpack-dev-server 3 接入 Poke。按住 Option（Windows/Linux 为 Alt）并点击页面元素，即可从 DOM
          节点定位到源码位置，再让本地编码 agent 直接修改对应组件。
        </p>
      </section>
    </main>
  )
}

ReactDOM.render(<App />, document.getElementById('root'))
