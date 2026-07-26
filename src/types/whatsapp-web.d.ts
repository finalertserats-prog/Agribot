/**
 * Minimal ambient declaration for whatsapp-web.js — just the surface the Plan B
 * group transport (src/lib/whatsappWeb.ts) uses. Lets the project typecheck and
 * build WITHOUT the heavy package (Puppeteer/Chromium) installed; the real
 * module is pulled in via dynamic import only when GROUP_TRANSPORT=whatsapp-web.
 * Install `whatsapp-web.js` on the host to actually run that transport.
 */
declare module "whatsapp-web.js" {
  export interface MessageMedia {
    mimetype: string;
    /** base64-encoded bytes */
    data: string;
    filename?: string;
  }
  export interface Chat {
    isGroup: boolean;
    name: string;
    id: { _serialized: string };
  }
  export interface Contact {
    pushname?: string;
    number?: string;
  }
  export interface Message {
    from: string;
    author?: string;
    body: string;
    hasMedia: boolean;
    type: string;
    getChat(): Promise<Chat>;
    getContact(): Promise<Contact>;
    downloadMedia(): Promise<MessageMedia | undefined>;
  }
  export interface LocalAuthOptions {
    dataPath?: string;
    clientId?: string;
  }
  export class LocalAuth {
    constructor(opts?: LocalAuthOptions);
  }
  export interface ClientOptions {
    authStrategy?: LocalAuth;
    puppeteer?: { headless?: boolean; args?: string[]; executablePath?: string };
  }
  export class Client {
    constructor(opts?: ClientOptions);
    initialize(): Promise<void>;
    on(event: "qr", cb: (qr: string) => void): this;
    on(event: "ready", cb: () => void): this;
    on(event: "authenticated", cb: () => void): this;
    on(event: "auth_failure", cb: (msg: string) => void): this;
    on(event: "disconnected", cb: (reason: string) => void): this;
    on(event: "message", cb: (msg: Message) => void | Promise<void>): this;
    on(event: string, cb: (...args: unknown[]) => void): this;
    sendMessage(chatId: string, content: string): Promise<Message>;
    requestPairingCode(phoneNumber: string): Promise<string>;
    destroy(): Promise<void>;
    info?: { wid: { _serialized: string } };
  }
}
