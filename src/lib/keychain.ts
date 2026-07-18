import { AsyncEntry } from "@napi-rs/keyring";
import type { OAuthClientCredentials } from "./types";

const DEFAULT_SERVICE = "dev.kissy24.workout-board";
const CLIENT_ACCOUNT = "oauth-client";
const REFRESH_ACCOUNT = "refresh-token";

export interface SecretStore {
  getOAuthClient(): Promise<OAuthClientCredentials | null>;
  setOAuthClient(credentials: OAuthClientCredentials): Promise<void>;
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  deleteRefreshToken(): Promise<void>;
  clear(): Promise<void>;
}

async function getSecret(service: string, account: string): Promise<string | null> {
  try {
    return (await new AsyncEntry(service, account).getPassword()) ?? null;
  } catch {
    throw new Error("macOS Keychainから認証情報を読み取れませんでした。");
  }
}

async function setSecret(service: string, account: string, secret: string): Promise<void> {
  if (!secret || secret.includes("\n")) throw new Error("保存する認証情報が不正です。");
  try {
    await new AsyncEntry(service, account).setPassword(secret);
  } catch {
    throw new Error("macOS Keychainへ認証情報を保存できませんでした。");
  }
}

async function deleteSecret(service: string, account: string): Promise<void> {
  try {
    await new AsyncEntry(service, account).deleteCredential();
  } catch {
    throw new Error("macOS Keychainから認証情報を削除できませんでした。");
  }
}

export class MacOSKeychainStore implements SecretStore {
  constructor(private readonly service = DEFAULT_SERVICE) {}

  async getOAuthClient(): Promise<OAuthClientCredentials | null> {
    const value = await getSecret(this.service, CLIENT_ACCOUNT);
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!validOAuthClientCredentials(parsed)) throw new Error("invalid credentials");
      return parsed;
    } catch (error) {
      throw new Error("Keychain内のOAuthクライアント情報が壊れています。", { cause: error });
    }
  }

  async setOAuthClient(credentials: OAuthClientCredentials): Promise<void> {
    await setSecret(this.service, CLIENT_ACCOUNT, JSON.stringify(credentials));
  }

  getRefreshToken(): Promise<string | null> {
    return getSecret(this.service, REFRESH_ACCOUNT);
  }

  setRefreshToken(token: string): Promise<void> {
    return setSecret(this.service, REFRESH_ACCOUNT, token);
  }

  deleteRefreshToken(): Promise<void> {
    return deleteSecret(this.service, REFRESH_ACCOUNT);
  }

  async clear(): Promise<void> {
    await Promise.all([
      deleteSecret(this.service, CLIENT_ACCOUNT),
      deleteSecret(this.service, REFRESH_ACCOUNT),
    ]);
  }
}

export function parseOAuthClientJson(raw: string): OAuthClientCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OAuthクライアントJSONを読み取れません。");
  }
  const source = (parsed as { installed?: Record<string, unknown> })?.installed;
  if (!source) throw new Error("Google Desktopアプリ用のOAuthクライアントJSONを選択してください。");
  const clientId = source.client_id;
  const clientSecret = source.client_secret;
  const authUri = source.auth_uri;
  const tokenUri = source.token_uri;
  const credentials = { clientId, clientSecret, authUri, tokenUri };
  if (!validOAuthClientCredentials(credentials)) {
    throw new Error("Google OAuthクライアントの内容またはエンドポイントが不正です。");
  }
  return credentials;
}

function validOAuthClientCredentials(value: unknown): value is OAuthClientCredentials {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.clientId === "string" &&
    candidate.clientId.endsWith(".apps.googleusercontent.com") &&
    typeof candidate.clientSecret === "string" &&
    candidate.clientSecret.length >= 8 &&
    candidate.authUri === "https://accounts.google.com/o/oauth2/auth" &&
    candidate.tokenUri === "https://oauth2.googleapis.com/token"
  );
}
