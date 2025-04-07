package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/go-redis/redis/v8"
	"github.com/gorilla/mux"
)

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error string `json:"error"`
}

// writeError writes an error response
func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(ErrorResponse{Error: message})
}

// **************************************************
// route: /pb
// paste static HTTP page
// **************************************************

func pbStaticPage(w http.ResponseWriter, r *http.Request) {
	body, err := os.ReadFile("public/pb.html")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to read static file")
		return
	}
	w.Header().Set("Content-Type", "text/html")
	w.Write(body)
}

// **************************************************
// route: /api/v1/pb
// paste board
// **************************************************

type pbStruct struct {
	Text string `json:"text"`
}

func getPB(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()

	result, err := redisClient.Get(ctx, "pb").Result()
	if err == redis.Nil {
		writeError(w, http.StatusNotFound, "No content found")
		return
	}
	if err != nil {
		log.Printf("Redis error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	pb := pbStruct{Text: result}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pb)
}

func setPB(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()

	var pb pbStruct
	if err := json.NewDecoder(r.Body).Decode(&pb); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON payload")
		return
	}

	// Validate text length
	if len(pb.Text) > 10000 {
		writeError(w, http.StatusBadRequest, "Text too long")
		return
	}

	err := redisClient.Set(ctx, "pb", pb.Text, 0).Err()
	if err != nil {
		log.Printf("Redis error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// **************************************************
// route: /api/v1/surl
// power for shorten url
// **************************************************

type sURLRequest struct {
	URL     string `json:"url"`
	Shorten string `json:"shorten"`
}

func setShortenURL(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()

	var sURL sURLRequest
	if err := json.NewDecoder(r.Body).Decode(&sURL); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON payload")
		return
	}

	// Validate URL
	if !validateURL(sURL.URL) {
		writeError(w, http.StatusBadRequest, "Invalid URL")
		return
	}

	// Validate or generate shorten
	if sURL.Shorten == "" {
		sURL.Shorten = randStr(4)
	}

	key := fmt.Sprintf("sURL.%s", sURL.Shorten)
	err := redisClient.Set(ctx, key, sURL.URL, 0).Err()
	if err != nil {
		log.Printf("Redis error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sURL)
}

func getShortenURL(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()

	shorten, ok := mux.Vars(r)["shorten"]
	if !ok {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}

	key := fmt.Sprintf("sURL.%s", shorten)
	shortenURL, err := redisClient.Get(ctx, key).Result()
	if err == redis.Nil {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}
	if err != nil {
		log.Printf("Redis error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	w.Header().Set("Location", shortenURL)
	w.WriteHeader(http.StatusMovedPermanently)
}

type sURLResponse struct {
	URL     string `json:"url"`
	Shorten string `json:"shorten"`
}

func listShortenURL(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	sURLList := make([]sURLResponse, 0)

	var cursor uint64
	for {
		keys, nextCursor, err := redisClient.Scan(ctx, cursor, "sURL.*", 20).Result()
		if err != nil {
			log.Printf("Redis error: %v", err)
			writeError(w, http.StatusInternalServerError, "Internal server error")
			return
		}

		for _, key := range keys {
			targetURL, err := redisClient.Get(ctx, key).Result()
			if err != nil {
				log.Printf("Redis error: %v", err)
				continue
			}

			shorten := strings.TrimPrefix(key, "sURL.")
			sURLList = append(sURLList, sURLResponse{
				URL:     targetURL,
				Shorten: shorten,
			})
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sURLList)
}

func deleteShortenURL(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()

	shorten, ok := mux.Vars(r)["shorten"]
	if !ok {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}

	key := fmt.Sprintf("sURL.%s", shorten)
	result, err := redisClient.Del(ctx, key).Result()
	if err != nil {
		log.Printf("Redis error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if result == 0 {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
