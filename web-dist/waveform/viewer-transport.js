"use strict";
var VeriflowWaveTransport = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // packages/waveform-webview/src/viewer-transport.ts
  var require_viewer_transport = __commonJS({
    "packages/waveform-webview/src/viewer-transport.ts"(exports, module) {
      function createWaveformTransport(environment) {
        const listeners = /* @__PURE__ */ new Set();
        const pending = [];
        let kind = "memory";
        let sendToHost = (message) => {
          pending.push(message);
        };
        let getState = () => null;
        let setState = (_value) => void 0;
        let removeHostListener = () => void 0;
        function dispatch(message, mirrorToWindow = true) {
          listeners.forEach((listener) => listener(message));
          if (mirrorToWindow && typeof environment.dispatchEvent === "function" && typeof environment.MessageEvent === "function") {
            environment.dispatchEvent(new environment.MessageEvent("message", { data: message }));
          }
        }
        const memory = environment.__waveformMemoryTransport;
        if (memory && typeof memory.send === "function") {
          kind = "memory";
          sendToHost = (message) => memory.send(message);
          if (typeof memory.onMessage === "function") {
            removeHostListener = memory.onMessage((message) => dispatch(message));
          }
        } else if (typeof environment.acquireVsCodeApi === "function") {
          kind = "vscode";
          const vscode = environment.acquireVsCodeApi();
          sendToHost = (message) => vscode.postMessage(message);
          getState = () => vscode.getState?.() ?? null;
          setState = (value) => vscode.setState?.(value);
          environment.addEventListener?.("message", (event) => dispatch(event.data, false));
        } else if (environment.qt && typeof environment.QWebChannel === "function") {
          kind = "qt";
          new environment.QWebChannel(environment.qt.webChannelTransport, (channel) => {
            const bridge = channel.objects.waveformBridge;
            bridge.message.connect((payload) => {
              try {
                dispatch(JSON.parse(payload));
              } catch (error) {
                dispatch({ type: "bridgeError", message: String(error) });
              }
            });
            sendToHost = (message) => bridge.send(JSON.stringify(message));
            pending.splice(0).forEach(sendToHost);
          });
        }
        return {
          kind,
          send(message) {
            sendToHost(message);
          },
          onMessage(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          getState() {
            return getState();
          },
          setState(value) {
            setState(value);
          },
          dispose() {
            removeHostListener?.();
            listeners.clear();
            pending.length = 0;
          },
          dispatch
        };
      }
      var browserGlobal = globalThis;
      if (typeof browserGlobal.document === "object") {
        browserGlobal.waveformTransport = createWaveformTransport(browserGlobal);
      }
      module.exports = { createWaveformTransport };
    }
  });
  return require_viewer_transport();
})();
