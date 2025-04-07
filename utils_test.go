package main

import (
	"testing"
)

func TestRandStr(t *testing.T) {
	tests := []struct {
		name string
		n    int
	}{
		{"4 characters", 4},
		{"8 characters", 8},
		{"16 characters", 16},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := randStr(tt.n)
			if len(got) != tt.n {
				t.Errorf("randStr() length = %v, want %v", len(got), tt.n)
			}

			// Check if all characters are valid
			for _, c := range got {
				if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
					t.Errorf("randStr() contains invalid character: %c", c)
				}
			}
		})
	}
}

func TestValidateURL(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		{
			name:     "Valid HTTP URL",
			input:    "http://example.com",
			expected: true,
		},
		{
			name:     "Valid URL with query parameters",
			input:    "https://example.com/path?param=value",
			expected: true,
		},
		{
			name:     "Invalid URL - missing scheme",
			input:    "example.com",
			expected: false,
		},
		{
			name:     "Invalid URL - missing host",
			input:    "http://",
			expected: false,
		},
		{
			name:     "Invalid URL - empty string",
			input:    "",
			expected: false,
		},
		{
			name:     "Invalid URL - malformed",
			input:    "http://example.com:invalid",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := validateURL(tt.input)
			if result != tt.expected {
				t.Errorf("validateURL(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}
