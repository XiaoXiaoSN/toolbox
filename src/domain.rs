use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use url::Url;

pub const MAX_TEXT_BYTES: usize = 10_000;
pub const MAX_BODY_BYTES: usize = 65_536;
pub const MAX_URL_BYTES: usize = 8_192;
pub const MAX_CODE_BYTES: usize = 64;
pub const DEFAULT_PAGE_SIZE: usize = 100;
pub const MAX_PAGE_SIZE: usize = 1_000;
const ALPHABET: &[u8; 64] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Clipboard {
    pub text: String,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ShortLink {
    pub url: String,
    #[serde(default)]
    pub shorten: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Page {
    pub limit: usize,
    pub after: String,
}

pub fn validate_text(text: &str) -> Result<(), &'static str> {
    if text.len() > MAX_TEXT_BYTES {
        return Err("Text exceeds 10000 UTF-8 bytes");
    }
    Ok(())
}

pub fn valid_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= MAX_CODE_BYTES
        && code
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        && !["api", "pb", "marquee", "surl", "assets", "index", "healthz"]
            .iter()
            .any(|reserved| code.eq_ignore_ascii_case(reserved))
}

pub fn normalise_url(value: &str) -> Result<String, &'static str> {
    if value.is_empty()
        || value.len() > MAX_URL_BYTES
        || value.chars().any(char::is_control)
        || value.trim() != value
        || value.contains('\\')
    {
        return Err("Invalid URL");
    }
    let parsed = Url::parse(value).map_err(|_| "Invalid URL")?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("URL must be absolute HTTP(S), without credentials");
    }
    let result: String = parsed.into();
    if result.len() > MAX_URL_BYTES {
        return Err("URL exceeds 8192 bytes after normalisation");
    }
    Ok(result)
}

pub fn authorised(header: Option<&str>, secret: &str) -> bool {
    let Some(header) = header else {
        return false;
    };
    let Some((scheme, token)) = header.split_once(' ') else {
        return false;
    };
    secret.len() >= 32
        && scheme.eq_ignore_ascii_case("Bearer")
        && bool::from(token.as_bytes().ct_eq(secret.as_bytes()))
}

pub fn random_code(bytes: [u8; 8]) -> String {
    // A 64-character alphabet divides 256 exactly: no modulo bias.
    bytes
        .iter()
        .map(|byte| char::from(ALPHABET[usize::from(byte & 63)]))
        .collect()
}

pub fn parse_page(query: Option<&str>) -> Result<Page, &'static str> {
    let mut page = Page {
        limit: DEFAULT_PAGE_SIZE,
        after: String::new(),
    };
    for (key, value) in url::form_urlencoded::parse(query.unwrap_or_default().as_bytes()) {
        match key.as_ref() {
            "limit" => {
                page.limit = value.parse().map_err(|_| "Invalid limit")?;
                if !(1..=MAX_PAGE_SIZE).contains(&page.limit) {
                    return Err("Limit must be between 1 and 1000");
                }
            }
            "after" => {
                if !value.is_empty() && !valid_code(&value) {
                    return Err("Invalid cursor");
                }
                page.after = value.into_owned();
            }
            _ => return Err("Unknown query parameter"),
        }
    }
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_limit_counts_bytes_not_characters() {
        assert!(validate_text("").is_ok());
        assert!(validate_text(&"a".repeat(10_000)).is_ok());
        assert!(validate_text(&"a".repeat(10_001)).is_err());
        assert!(validate_text(&"台".repeat(3_333)).is_ok());
        assert!(validate_text(&"台".repeat(3_334)).is_err());
    }

    #[test]
    fn missing_and_null_clipboard_are_not_empty_text() {
        for body in ["{}", r#"{"text":null}"#, r#"{"text":5}"#] {
            assert!(serde_json::from_str::<Clipboard>(body).is_err());
        }
        assert_eq!(
            serde_json::from_str::<Clipboard>(r#"{"text":""}"#).unwrap(),
            Clipboard {
                text: String::new()
            }
        );
    }

    #[test]
    fn codes_cannot_shadow_pages_or_escape_the_path() {
        for code in [
            "", "pb", "PB", "api", "surl", "marquee", ".", "..", "a/b", "a?b", "a%2fb", "台",
        ] {
            assert!(!valid_code(code), "{code}");
        }
        assert!(valid_code("a_A-012"));
        assert!(valid_code(&"a".repeat(64)));
        assert!(!valid_code(&"a".repeat(65)));
    }

    #[test]
    fn only_safe_absolute_web_urls_are_accepted() {
        for value in [
            "javascript:alert(1)",
            "data:text/html,test",
            "ftp://example.com/a",
            "/relative",
            "//example.com/a",
            "https://user:pass@example.com/",
            "https://example.com/\r\nX-Test: yes",
            " https://example.com/",
            "https://example.com\\evil",
        ] {
            assert!(normalise_url(value).is_err(), "{value}");
        }
        assert_eq!(
            normalise_url("https://example.com").unwrap(),
            "https://example.com/"
        );
        assert!(normalise_url("https://example.com/台灣?q=1#part").is_ok());
    }

    #[test]
    fn bearer_tokens_fail_closed() {
        let secret = "0123456789abcdef0123456789abcdef";
        assert!(authorised(Some(&format!("Bearer {secret}")), secret));
        assert!(authorised(Some(&format!("bearer {secret}")), secret));
        assert!(!authorised(None, secret));
        assert!(!authorised(Some("Bearer short"), "short"));
        assert!(!authorised(Some(&format!("Basic {secret}")), secret));
        assert!(!authorised(Some(&format!("Bearer {secret}x")), secret));
        assert!(!authorised(Some(&format!("Bearer {secret}")), ""));
    }

    #[test]
    fn generated_codes_have_fixed_length_and_safe_characters() {
        assert_eq!(random_code([0; 8]), "00000000");
        assert_eq!(random_code([255; 8]), "--------");
        for byte in 0..=255 {
            let code = random_code([byte; 8]);
            assert_eq!(code.len(), 8);
            assert!(valid_code(&code));
        }
    }

    #[test]
    fn pagination_is_bounded() {
        assert_eq!(parse_page(None).unwrap().limit, 100);
        assert_eq!(
            parse_page(Some("limit=2&after=abc")).unwrap(),
            Page {
                limit: 2,
                after: "abc".into()
            }
        );
        for query in [
            "limit=0",
            "limit=1001",
            "limit=-1",
            "limit=x",
            "after=a%2Fb",
            "typo=1",
        ] {
            assert!(parse_page(Some(query)).is_err(), "{query}");
        }
    }

    #[test]
    fn omitted_short_code_requests_generation() {
        let link: ShortLink = serde_json::from_str(r#"{"url":"https://example.com/"}"#).unwrap();
        assert!(link.shorten.is_empty());
    }
}
