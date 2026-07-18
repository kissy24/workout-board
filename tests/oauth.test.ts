import { afterEach, describe, expect, test } from "bun:test";
import type { SecretStore } from "../src/lib/keychain";
import { AuthenticationRequiredError, GoogleOAuth } from "../src/lib/oauth";
import type { OAuthClientCredentials } from "../src/lib/types";

const credentials: OAuthClientCredentials = {
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "secret-value",
  authUri: "https://accounts.google.com/o/oauth2/auth",
  tokenUri: "https://oauth2.googleapis.com/token",
};

class MemorySecrets implements SecretStore {
  client: OAuthClientCredentials | null = credentials;
  refreshToken: string | null = null;
  getOAuthClient = async () => this.client;
  setOAuthClient = async (value: OAuthClientCredentials) => {
    this.client = value;
  };
  getRefreshToken = async () => this.refreshToken;
  setRefreshToken = async (value: string) => {
    this.refreshToken = value;
  };
  deleteRefreshToken = async () => {
    this.refreshToken = null;
  };
  clear = async () => {
    this.client = null;
    this.refreshToken = null;
  };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GoogleOAuth", () => {
  test("stateとS256 PKCEを含む読み取り専用認証URLを生成する", async () => {
    const oauth = new GoogleOAuth(new MemorySecrets());
    const result = await oauth.createAuthorization("http://127.0.0.1:4173");
    const url = new URL(result.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    );
    expect(url.searchParams.get("state")).toBe(result.pending.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(result.pending.codeVerifier.length).toBeGreaterThan(40);
  });

  test("認証コード交換でrefresh tokenを秘密ストアへ保存する", async () => {
    const secrets = new MemorySecrets();
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(init?.body)).toContain("grant_type=authorization_code");
      return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
    }) as unknown as typeof fetch;
    const oauth = new GoogleOAuth(secrets);
    await oauth.completeAuthorization("code", "verifier", "http://127.0.0.1:4173");
    expect(secrets.refreshToken).toBe("refresh");
    expect(await oauth.getAccessToken()).toBe("access");
  });

  test("refresh tokenがなければ再認証を要求する", async () => {
    const oauth = new GoogleOAuth(new MemorySecrets());
    expect(oauth.getAccessToken()).rejects.toBeInstanceOf(AuthenticationRequiredError);
  });
});
