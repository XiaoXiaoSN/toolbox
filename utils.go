package main

import (
	"math/rand"
	"time"
)

var (
	lowerLetters = "abcdefghijklmnopqrstuvwxyz"
	upperLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	numbers      = "1234567890"
)

func init() {
	rand.Seed(time.Now().UnixNano())
}

func randStr(n int) string {
	letters := []rune(lowerLetters + upperLetters + numbers)

	b := make([]rune, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}
