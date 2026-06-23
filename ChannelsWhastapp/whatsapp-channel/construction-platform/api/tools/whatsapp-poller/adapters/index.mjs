// Adapter selector. Picks the bridge implementation by cfg.bridge
// (env BRIDGE=whatsappMcp|mock, default mock).
//
// All adapters implement the BridgeAdapter interface:
//   async fetchIncoming(sinceCursor)
//     -> { messages: [{ jid, from, body, mediaType?, timestamp, messageId }], cursor }
//   async sendMessage(toBareNumber, text) -> void
//   close?() -> void   (optional cleanup)

export async function selectAdapter(cfg, logger = console) {
  switch (cfg.bridge) {
    case 'whatsappMcp': {
      const { createAdapter } = await import('./whatsappMcp.mjs');
      return createAdapter(cfg, logger);
    }
    case 'mock':
    default: {
      const { createAdapter } = await import('./mock.mjs');
      return createAdapter(cfg, logger);
    }
  }
}
