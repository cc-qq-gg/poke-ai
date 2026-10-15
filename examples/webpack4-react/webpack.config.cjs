const HtmlWebpackPlugin = require('html-webpack-plugin')
const { PokeWebpackPlugin } = require('@poke-dev/webpack')

// Webpack 4 + webpack-dev-server 3 example: Poke injects its client entry, the
// source loader and the `/__poke/*` dev-server middleware (via `before`).
module.exports = {
  devServer: {
    open: false,
    port: 5181,
  },
  entry: './src/main.tsx',
  mode: 'development',
  module: {
    rules: [
      {
        exclude: /node_modules/,
        test: /\.[jt]sx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
          },
        },
      },
      {
        test: /\.css$/u,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    // 在这里添加 PokeWebpackPlugin 插件即可
    new PokeWebpackPlugin(),
    new HtmlWebpackPlugin({ template: './src/index.html' }),
  ],
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
}
