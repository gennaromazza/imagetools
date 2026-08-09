export interface FirebaseAnonymousAuthState {
  localId: string;
  refreshToken: string;
}

interface FirebaseSignInResponse {
  idToken: string;
  refreshToken: string;
  localId: string;
  expiresIn: string;
}

interface FirebaseRefreshResponse {
  id_token: string;
  refresh_token: string;
  user_id: string;
  expires_in: string;
}

export class FirebaseAnonymousAuth {
  private state: FirebaseAnonymousAuthState | null;
  private idToken = "";
  private idTokenExpiresAt = 0;

  constructor(
    private readonly apiKey: string,
    initialState: FirebaseAnonymousAuthState | null = null,
    private readonly onChange?: () => void,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.state = initialState;
  }

  exportState(): FirebaseAnonymousAuthState | null {
    return this.state ? { ...this.state } : null;
  }

  async getIdToken(): Promise<string> {
    if (this.idToken && this.idTokenExpiresAt > Date.now() + 60_000) return this.idToken;
    if (this.state?.refreshToken) {
      try { return await this.refresh(); } catch { this.state = null; }
    }
    return this.signIn();
  }

  private async signIn(): Promise<string> {
    const response = await this.fetcher(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    if (!response.ok) throw new Error(`Identità FileX Cloud non disponibile (${response.status}).`);
    const body = await response.json() as FirebaseSignInResponse;
    this.apply(body.idToken, body.refreshToken, body.localId, body.expiresIn);
    return this.idToken;
  }

  private async refresh(): Promise<string> {
    const response = await this.fetcher(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.state!.refreshToken }),
    });
    if (!response.ok) throw new Error(`Rinnovo identità FileX Cloud non riuscito (${response.status}).`);
    const body = await response.json() as FirebaseRefreshResponse;
    this.apply(body.id_token, body.refresh_token, body.user_id, body.expires_in);
    return this.idToken;
  }

  private apply(idToken: string, refreshToken: string, localId: string, expiresIn: string): void {
    if (!idToken || !refreshToken || !localId) throw new Error("Risposta identità FileX Cloud non valida.");
    this.idToken = idToken;
    this.idTokenExpiresAt = Date.now() + Math.max(60, Number(expiresIn) || 3600) * 1000;
    this.state = { localId, refreshToken };
    this.onChange?.();
  }
}
