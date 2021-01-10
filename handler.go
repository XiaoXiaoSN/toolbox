package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/gorilla/mux"
	"gopkg.in/redis.v4"
)

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
	result, err := redisClient.Get("pb").Result()
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
	decoder := json.NewDecoder(r.Body)

	var pb pbStruct
	err := decoder.Decode(&pb)
	if err != nil {
		log.Println(err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	err = redisClient.Set("pb", pb.Text, 0).Err()
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
		getShortenURL(w, r)
		return
	}
}

type sURLRequest struct {
	URL     string `json:"url"`
	Shorten string `json:"shorten"`
}

func setShortenURL(w http.ResponseWriter, r *http.Request) {
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

	err = redisClient.Set(fmt.Sprintf("sURL.%s", sURL.Shorten), sURL.URL, 0).Err()
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
	shorten, ok := mux.Vars(r)["shorten"]
	if !ok {
		io.WriteString(w, "404 - not found")
		w.WriteHeader(http.StatusNotFound)
		return
	}

	key := fmt.Sprintf("sURL.%s", shorten)
	shortenURL, err := redisClient.Get(key).Result()
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
