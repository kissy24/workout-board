import { describe, expect, test } from "bun:test";
import { extractSpreadsheetReference } from "../src/lib/config";
import { parseOAuthClientJson } from "../src/lib/keychain";

describe("extractSpreadsheetReference", () => {
  test("正規のGoogle Sheets URLからIDとgidを抽出する", () => {
    const result = extractSpreadsheetReference(
      "https://docs.google.com/spreadsheets/d/1234567890abcdefghijABCDEFGHIJ/edit?usp=sharing#gid=42",
    );
    expect(result.spreadsheetId).toBe("1234567890abcdefghijABCDEFGHIJ");
    expect(result.gid).toBe(42);
    expect(result.canonicalUrl).toEndWith("/edit#gid=42");
  });

  test("Google以外のホストとHTTPを拒否する", () => {
    expect(() =>
      extractSpreadsheetReference(
        "https://docs.google.com.evil.example/spreadsheets/d/1234567890abcdefghijABCDEFGHIJ/edit",
      ),
    ).toThrow("docs.google.com");
    expect(() =>
      extractSpreadsheetReference(
        "http://docs.google.com/spreadsheets/d/1234567890abcdefghijABCDEFGHIJ/edit",
      ),
    ).toThrow("HTTPS");
  });
});

describe("parseOAuthClientJson", () => {
  test("Google Desktop OAuthクライアントだけを受け付ける", () => {
    const parsed = parseOAuthClientJson(
      JSON.stringify({
        installed: {
          client_id: "client.apps.googleusercontent.com",
          client_secret: "secret-value",
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
        },
      }),
    );
    expect(parsed.clientId).toBe("client.apps.googleusercontent.com");
  });

  test("Webクライアントや差し替えられたtoken endpointを拒否する", () => {
    expect(() => parseOAuthClientJson(JSON.stringify({ web: {} }))).toThrow("Desktop");
    expect(() =>
      parseOAuthClientJson(
        JSON.stringify({
          installed: {
            client_id: "client.apps.googleusercontent.com",
            client_secret: "secret-value",
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://evil.example/token",
          },
        }),
      ),
    ).toThrow("エンドポイント");
  });
});
