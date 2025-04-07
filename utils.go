package main

import (
	"crypto/rand"
	"encoding/base64"
	"math/big"
	"net/url"
)

// randStr generates a cryptographically secure random string
func randStr(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, n)

	for i := 0; i < n; i++ {
		num, err := rand.Int(rand.Reader, big.NewInt(int64(len(letters))))
		if err != nil {
			// Fallback to base64 if crypto/rand fails
			b := make([]byte, n)
			_, err := rand.Read(b)
			if err != nil {
				panic(err) // This should never happen
			}
			return base64.URLEncoding.EncodeToString(b)[:n]
		}
		result[i] = letters[num.Int64()]
	}

	return string(result)
}

// validateURL validates if a string is a valid URL
func validateURL(input string) bool {
	u, err := url.Parse(input)
	return err == nil && u.Scheme != "" && u.Host != ""
}
