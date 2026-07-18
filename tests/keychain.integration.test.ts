import { expect, test } from "bun:test";
import { MacOSKeychainStore } from "../src/lib/keychain";
import type { OAuthClientCredentials } from "../src/lib/types";

test.skipIf(Bun.env.WORKOUT_BOARD_KEYCHAIN_TEST !== "1")(
  "macOS Keychainで認証情報を保存・取得・削除する",
  async () => {
    const store = new MacOSKeychainStore(`dev.kissy24.workout-board.test.${crypto.randomUUID()}`);
    const credentials: OAuthClientCredentials = {
      clientId: "integration-test.apps.googleusercontent.com",
      clientSecret: "integration-secret",
      authUri: "https://accounts.google.com/o/oauth2/auth",
      tokenUri: "https://oauth2.googleapis.com/token",
    };
    try {
      await store.setOAuthClient(credentials);
      await store.setRefreshToken("integration-refresh-token");
      expect(await store.getOAuthClient()).toEqual(credentials);
      expect(await store.getRefreshToken()).toBe("integration-refresh-token");
    } finally {
      await store.clear();
    }
    expect(await store.getOAuthClient()).toBeNull();
    expect(await store.getRefreshToken()).toBeNull();
  },
);
