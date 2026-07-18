import type { SecretStore } from "./keychain";
import type { AccessToken, OAuthClientCredentials } from "./types";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const EXPIRY_MARGIN_MS = 60_000;

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export interface PendingAuthorization {
  state: string;
  codeVerifier: string;
  createdAt: number;
}

export class GoogleOAuth {
  #accessToken: AccessToken | null = null;

  constructor(private readonly secrets: SecretStore) {}

  async createAuthorization(
    origin: string,
  ): Promise<{ url: string; pending: PendingAuthorization }> {
    const client = await this.requireClient();
    const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(64)));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
    const redirectUri = `${origin}/oauth/callback`;
    const url = new URL(client.authUri);
    url.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state,
      code_challenge: base64Url(new Uint8Array(digest)),
      code_challenge_method: "S256",
    }).toString();
    return { url: url.toString(), pending: { state, codeVerifier, createdAt: Date.now() } };
  }

  async completeAuthorization(code: string, verifier: string, origin: string): Promise<void> {
    const client = await this.requireClient();
    const response = await fetch(client.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: `${origin}/oauth/callback`,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    const data = (await safeJson(response)) as TokenResponse;
    if (!response.ok || typeof data.access_token !== "string") {
      throw new Error("Google認証コードをアクセストークンへ交換できませんでした。");
    }
    if (typeof data.refresh_token === "string")
      await this.secrets.setRefreshToken(data.refresh_token);
    this.#accessToken = {
      value: data.access_token,
      expiresAt: Date.now() + validExpiresIn(data.expires_in) * 1_000,
    };
  }

  async isAuthorized(): Promise<boolean> {
    if (this.#accessToken && this.#accessToken.expiresAt > Date.now() + EXPIRY_MARGIN_MS)
      return true;
    return (await this.secrets.getRefreshToken()) !== null;
  }

  async getAccessToken(): Promise<string> {
    if (this.#accessToken && this.#accessToken.expiresAt > Date.now() + EXPIRY_MARGIN_MS) {
      return this.#accessToken.value;
    }
    const [client, refreshToken] = await Promise.all([
      this.requireClient(),
      this.secrets.getRefreshToken(),
    ]);
    if (!refreshToken) throw new AuthenticationRequiredError();
    const response = await fetch(client.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = (await safeJson(response)) as TokenResponse;
    if (!response.ok || typeof data.access_token !== "string") {
      if (data.error === "invalid_grant") await this.secrets.deleteRefreshToken();
      throw new AuthenticationRequiredError();
    }
    this.#accessToken = {
      value: data.access_token,
      expiresAt: Date.now() + validExpiresIn(data.expires_in) * 1_000,
    };
    return this.#accessToken.value;
  }

  async logout(): Promise<void> {
    this.#accessToken = null;
    await this.secrets.deleteRefreshToken();
  }

  private async requireClient(): Promise<OAuthClientCredentials> {
    const client = await this.secrets.getOAuthClient();
    if (!client) throw new OAuthClientRequiredError();
    return client;
  }
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  error?: unknown;
}

function validExpiresIn(value: unknown): number {
  return typeof value === "number" && value >= 60 && value <= 86_400 ? value : 3_600;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export class AuthenticationRequiredError extends Error {}
export class OAuthClientRequiredError extends Error {}
