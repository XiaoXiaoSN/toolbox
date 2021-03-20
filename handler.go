package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"

	"github.com/go-redis/redis/v8"
	"github.com/gorilla/mux"
)

// **************************************************
// route: /pb
// paste static HTTP page
// **************************************************

func pbStaticPage(w http.ResponseWriter, r *http.Request) {
	body, _ := ioutil.ReadFile("public/pb.html")
	io.WriteString(w, string(body))
}

// **************************************************
// route: /api/v1/pb
// paste board
// **************************************************

func pbHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getPB(w, r)
	case http.MethodPost:
		setPB(w, r)
	}
}

type pbStruct struct {
	Text string `json:"text"`
}

func getPB(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()

	result, err := redisClient.Get(ctx, "pb").Result()
	if err != nil {
		log.Println(err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	pb := pbStruct{Text: result}
	pbBytes, err := json.Marshal(pb)
	if err != nil {
		log.Println(err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	io.WriteString(w, string(pbBytes))
}

func setPB(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	decoder := json.NewDecoder(r.Body)

	var pb pbStruct
	err := decoder.Decode(&pb)
	if err != nil {
		log.Println(err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	err = redisClient.Set(ctx, "pb", pb.Text, 0).Err()
	if err != nil {
		log.Println(err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// **************************************************
// route: /api/v1/surl
// power for shorten url
// **************************************************

func shortenURLHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		setShortenURL(w, r)
		return
	case http.MethodGet:
		listShortenURL(w, r)
		return
	case http.MethodDelete:
		deleteShortenURL(w, r)
		return
	}
}

type sURLRequest struct {
	URL     string `json:"url"`
	Shorten string `json:"shorten"`
}

func setShortenURL(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	decoder := json.NewDecoder(r.Body)

	var sURL sURLRequest
	err := decoder.Decode(&sURL)
	if err != nil {
		log.Println(err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	if sURL.URL == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if sURL.Shorten == "" {
		sURL.Shorten = randStr(4)
	}

	key := fmt.Sprintf("sURL.%s", sURL.Shorten)
	err = redisClient.Set(ctx, key, sURL.URL, 0).Err()
	if err != nil {
		log.Println(err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	resp, err := json.Marshal(sURL)
	if err != nil {
		log.Println(err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(resp)
}

func getShortenURL(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()

	shorten, ok := mux.Vars(r)["shorten"]
	if !ok {
		io.WriteString(w, "404 - not found")
		w.WriteHeader(http.StatusNotFound)
		return
	}

	key := fmt.Sprintf("sURL.%s", shorten)
	shortenURL, err := redisClient.Get(ctx, key).Result()
	if err == redis.Nil {
		io.WriteString(w, "404 - not found")
		w.WriteHeader(http.StatusNotFound)
		return
	} else if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
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
	var n int
	for {
		var keys []string
		var err error

		keys, cursor, err = redisClient.Scan(ctx, cursor, "sURL.*", 20).Result()
		if err != nil {
			io.WriteString(w, "500 - redis error")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		n += len(keys)

		var targetURL string
		for _, key := range keys {
			targetURL, err = redisClient.Get(ctx, key).Result()
			if err == redis.Nil {
				io.WriteString(w, "404 - not found")
				w.WriteHeader(http.StatusNotFound)
				return
			} else if err != nil {
				io.WriteString(w, "500 - redis error")
				w.WriteHeader(http.StatusInternalServerError)
				return
			}

			sURLList = append(sURLList, sURLResponse{
				URL:     targetURL,
				Shorten: key,
			})
		}
		if cursor == 0 {
			break
		}
	}

	resp, err := json.Marshal(sURLList)
	if err != nil {
		log.Println(err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(resp)
}

func deleteShortenURL(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()

	shorten, ok := mux.Vars(r)["shorten"]
	if !ok {
		io.WriteString(w, "404 - not found")
		w.WriteHeader(http.StatusNotFound)
		return
	}

	key := fmt.Sprintf("sURL.%s", shorten)
	_, err := redisClient.Del(ctx, key).Result()
	if err == redis.Nil {
		io.WriteString(w, "404 - not found")
		w.WriteHeader(http.StatusNotFound)
		return
	} else if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}
