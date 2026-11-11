package handler

import (
	"net"
	"net/http"

	"k3/backend/internal/httpx"
)

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decode(w, r, &in); err != nil {
		httpx.Error(w, r, err)
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	res, err := a.Auth.Login(r.Context(), ip, in.Username, in.Password)
	if err != nil {
		httpx.Error(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: a.Cfg.AuthCookieName, Value: res.Token, Path: "/", Expires: res.ExpiresAt,
		MaxAge: int(a.Cfg.AuthTTL.Seconds()), HttpOnly: true, Secure: a.Cfg.AuthCookieSecure, SameSite: http.SameSiteStrictMode,
	})
	httpx.Data(w, http.StatusOK, map[string]any{"user": res.User, "csrf_token": res.CSRFToken})
}

func (a *API) me(w http.ResponseWriter, r *http.Request) {
	httpx.Data(w, http.StatusOK, map[string]any{"user": httpx.User(r.Context()), "csrf_token": httpx.CSRF(r.Context())})
}

func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := a.Auth.Logout(ctx, httpx.Token(ctx), httpx.User(ctx).ID); err != nil {
		httpx.Error(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: a.Cfg.AuthCookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: a.Cfg.AuthCookieSecure, SameSite: http.SameSiteStrictMode})
	w.WriteHeader(http.StatusNoContent)
}
