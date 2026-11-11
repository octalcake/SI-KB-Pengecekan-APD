package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

// Health reports status only (no paths, env or credentials). The users query
// also fails when migrations have not been applied.
func Health(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status, code := "ok", http.StatusOK
		var n int
		if err := db.QueryRowContext(r.Context(), "SELECT count(*) FROM users").Scan(&n); err != nil {
			status, code = "unavailable", http.StatusServiceUnavailable
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]string{"status": status}})
	}
}
