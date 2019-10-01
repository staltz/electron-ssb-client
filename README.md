# SSB Client for Electron apps

Similar to [ssb-client](https://github.com/ssbc/ssb-client), but for the Renderer process in Electron apps.

## Install

Prerequisites:

- Electron
- In your Electron Main process
  - [ssb-server](https://github.com/ssbc/ssb-server) (or [secret-stack](https://github.com/ssbc/secret-stack))
  - [multiserver-electron-ipc](https://gitlab.com/staltz/multiserver-electron-ipc)

```
npm install --save electron-ssb-client
```

## Usage

### Main process

In your **Main process** code, npm install `multiserver-electron-ipc`, and make sure that you have ssb-server or secret-stack installed, and add the following configurations set up:

```diff
 const SecretStack = require('secret-stack');
 const ssbKeys = require('ssb-keys');
+const electronIpcPlugin = require('multiserver-electron-ipc');
+const NoauthTransformPlugin = require('multiserver/plugins/noauth');

 const config = makeConfig('ssb', {
   connections: {
     incoming: {
       net: [{scope: 'private', transform: 'shs', port: 26831}],
+      channel: [{scope: 'device', transform: 'noauth'}],
     },
     outgoing: {
       net: [{transform: 'shs'}],
     },
   },
 });

+function electronIpcTransport(ssb) {
+  ssb.multiserver.transport({
+    name: 'channel',
+    create: () => electronIpcPlugin({ipcMain, webContentsPromise}),
+  });
+}

+function noAuthTransform(ssb, cfg) {
+  ssb.multiserver.transform({
+    name: 'noauth',
+    create: () =>
+      NoauthTransformPlugin({
+        keys: {publicKey: Buffer.from(cfg.keys.public, 'base64')},
+      }),
+  });
+}

 SecretStack({appKey: require('ssb-caps').shs})
   .use(require('ssb-db'))
+  .use(noAuthTransform)
+  .use(electronIpcTransport)
   .use(require('ssb-master'))
   .use(require('ssb-conn'))
   .use(require('ssb-blobs'))
   .use(require('ssb-ebt'))
   .call(null, config);
```

Note! **`ipcMain` and `webContentsPromise`**: these two arguments are needed to create `electronIpcPlugin`. The `ipcMain` is synchronously available as `var {ipcMain} = require('electron')` but `win.webContents` is available asynchronously after the Renderer window is built. Read up on [multiserver-electron-ipc](https://gitlab.com/staltz/multiserver-electron-ipc) docs on how to set those up, it will depend on the way you have structured the code for your Main process.

### Renderer process

In your **Renderer process** code we assume you have access to the muxrpc manifest object. Then, in your frontend code you import this library:

```js
import ssbClient from 'electron-ssb-client'

// ...

ssbClient(manifest)
  .use(somePlugin) // optional
  .call(null, (err, ssb) => {
    // You can now use `ssb` with all the muxrpc APIs from the backend
  })
```

### API

- `ssbClient(manifest)`: this configures your muxrpc client where `manifest` is an object describing the muxrpc APIs we want
- `.use(plugin)`: call this to attach a client-side `plugin` to your final muxrpc object. Plugins are `{name, init}` objects, where `name` is a string, and `init(ssb): void` is a function; much like secret-stack plugins are
- `.call(null, cb)`: call this to start using the muxrpc, it will be provided to you in the callback `cb`
- `.callPromise()`: as an alternative to the above, you can call this to get a Promise that resolves with the muxrpc `ssb` object

### Plugins

When setting up the client, you can register *plugins*. These look and feel like `ssb-server` or `secret-stack` plugins, in fact, in many cases they are so similar that a plugin intended for ssb-server might work just fine for electron-ssb-client! These frontend plugins should also work in [react-native-ssb-client](https://github.com/staltz/react-native-ssb-client)!

You can use client-side plugins when you are sure you don't want to run this code in the backend. For instance, a client-side plugin is the perfect place to put a light cache, in order to avoid a request to the backend. See e.g. [ssb-cached-about](https://gitlab.com/staltz/ssb-cached-about).

Below is a simple plugin that just publishes a greeting message in the DB:

```js
const greeterPlugin = {
  name: 'greetings',

  init: function (ssb) {
    return {
      greet: (cb) => {
        ssb.publish({type: 'post', text: 'Hello world!'}, cb)
      },
    }
  }
}
```

To install it:

```diff
 ssbClient(manifest)
+  .use(greeterPlugin)
   .call(null, (err, ssb) => {

   })
```

To use it:

```diff
 ssbClient(manifest)
   .use(greeterPlugin)
   .call(null, (err, ssb) => {
+    // Will publish a message on our feed:
+    ssb.greetings.greet((err, val) => { /* ... */ })
   })
```

## License

MIT
