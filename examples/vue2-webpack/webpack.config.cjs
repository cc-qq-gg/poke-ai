const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const { VueLoaderPlugin } = require('vue-loader')
const { PokeWebpackPlugin } = require('@poke-dev/webpack')

// Vue 2 + vue-loader 15 + webpack 4 example (legacy toolchain like vue-cli 3/4).
// PokeWebpackPlugin injects its client entry, the `.vue` source loader and the
// `/__poke/*` dev-server middleware. `output.hashFunction: 'sha256'` keeps
// webpack 4 running on modern Node without the OpenSSL legacy provider.
module.exports = {
  mode: 'development',
  entry: './src/main.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'main.js',
    hashFunction: 'sha256',
  },
  resolve: {
    extensions: ['.js', '.vue'],
  },
  devServer: {
    host: '0.0.0.0',
    port: 5182,
    open: false,
  },
  module: {
    rules: [
      {
        test: /\.vue$/u,
        loader: 'vue-loader',
      },
      {
        test: /\.css$/u,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new VueLoaderPlugin(),
    // 在这里添加 PokeWebpackPlugin 插件即可
    new PokeWebpackPlugin(),
    new HtmlWebpackPlugin({ template: './src/index.html' }),
  ],
}
