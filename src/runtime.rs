use futures_util::StreamExt;
use serde::{Serialize, de::DeserializeOwned};
use worker::{Context, Env, Method, Request, Response, event, wasm_bindgen::JsValue};

use crate::domain::{self, Clipboard, MAX_BODY_BYTES, ShortLink};

type ApiResult<T> = Result<T, ApiError>;

enum ApiError {
    Client(u16, &'static str),
    Internal(worker::Error),
}

impl From<worker::Error> for ApiError {
    fn from(error: worker::Error) -> Self {
        Self::Internal(error)
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: &'static str,
}

#[event(fetch)]
async fn fetch(mut request: Request, env: Env, _ctx: Context) -> worker::Result<Response> {
    let is_head = request.method() == Method::Head;
    let is_api = request.path().starts_with("/api/");
    let mut response = match dispatch(&mut request, &env).await {
        Ok(response) => response,
        Err(ApiError::Client(status, error)) => {
            Response::from_json(&ErrorBody { error })?.with_status(status)
        }
        Err(ApiError::Internal(error)) => {
            worker::console_error!("Toolbox request failed: {error}");
            Response::from_json(&ErrorBody {
                error: "Internal server error",
            })?
            .with_status(500)
        }
    };
    response.headers_mut().set("Cache-Control", "no-store")?;
    response
        .headers_mut()
        .set("X-Content-Type-Options", "nosniff")?;
    response
        .headers_mut()
        .set("Referrer-Policy", "no-referrer")?;
    if response.status_code() == 401 {
        response.headers_mut().set("WWW-Authenticate", "Bearer")?;
    }
    if is_api {
        let headers = response.headers_mut();
        headers.set("Access-Control-Allow-Origin", "*")?;
        headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type")?;
        headers.set(
            "Access-Control-Allow-Methods",
            "GET, HEAD, POST, DELETE, OPTIONS",
        )?;
        headers.set("Access-Control-Expose-Headers", "X-Next-Cursor")?;
    }
    if is_head {
        response = Response::empty()?
            .with_status(response.status_code())
            .with_headers(response.headers().clone());
    }
    Ok(response)
}

async fn dispatch(request: &mut Request, env: &Env) -> ApiResult<Response> {
    let path = request.path();
    let method = request.method();
    match path.as_str() {
        "/healthz" => {
            return match method {
                Method::Get | Method::Head => Ok(Response::ok("ok")?),
                _ => method_not_allowed("GET, HEAD"),
            };
        }
        "/api/v1/pb" | "/api/v1/surl" => {
            if method == Method::Options {
                return options("GET, HEAD, POST, OPTIONS");
            }
            if !matches!(method, Method::Get | Method::Head | Method::Post) {
                return method_not_allowed("GET, HEAD, POST, OPTIONS");
            }
            authenticate(request, env)?;
            return match (path.as_str(), method) {
                ("/api/v1/pb", Method::Post) => put_clipboard(request, env).await,
                ("/api/v1/pb", _) => get_clipboard(env).await,
                (_, Method::Post) => put_link(request, env).await,
                _ => list_links(request, env).await,
            };
        }
        _ => {}
    }
    if let Some(code) = path.strip_prefix("/api/v1/surl/") {
        if !domain::valid_code(code) {
            return Err(ApiError::Client(404, "Not found"));
        }
        if method == Method::Options {
            return options("DELETE, OPTIONS");
        }
        if method != Method::Delete {
            return method_not_allowed("DELETE, OPTIONS");
        }
        authenticate(request, env)?;
        return delete_link(code, env).await;
    }
    let code = path.strip_prefix('/').unwrap_or_default();
    if !domain::valid_code(code) {
        return Err(ApiError::Client(404, "Not found"));
    }
    if !matches!(method, Method::Get | Method::Head) {
        return method_not_allowed("GET, HEAD");
    }
    redirect(code, env).await
}

fn authenticate(request: &Request, env: &Env) -> ApiResult<()> {
    // Public API by default; deployments opt in by setting a non-empty token.
    let Ok(secret) = env.secret("API_TOKEN") else {
        return Ok(());
    };
    let secret = secret.to_string();
    if secret.is_empty() {
        return Ok(());
    }
    if secret.len() < 32 {
        return Err(ApiError::Client(
            503,
            "API_TOKEN must contain at least 32 bytes",
        ));
    }
    let header = request.headers().get("Authorization")?;
    if !domain::authorised(header.as_deref(), &secret) {
        return Err(ApiError::Client(401, "Unauthorised"));
    }
    Ok(())
}

fn options(allow: &str) -> ApiResult<Response> {
    let mut response = Response::empty()?.with_status(204);
    response.headers_mut().set("Allow", allow)?;
    Ok(response)
}

fn method_not_allowed(allow: &str) -> ApiResult<Response> {
    let mut response = Response::from_json(&ErrorBody {
        error: "Method not allowed",
    })?
    .with_status(405);
    response.headers_mut().set("Allow", allow)?;
    Ok(response)
}

async fn read_json<T: DeserializeOwned>(request: &mut Request) -> ApiResult<T> {
    if let Some(length) = request.headers().get("Content-Length")? {
        let length: usize = length
            .parse()
            .map_err(|_| ApiError::Client(400, "Invalid Content-Length"))?;
        if length > MAX_BODY_BYTES {
            return Err(ApiError::Client(413, "Request body exceeds 65536 bytes"));
        }
    }
    let mut stream = request
        .stream()
        .map_err(|_| ApiError::Client(400, "Missing request body"))?;
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| ApiError::Client(400, "Failed to read request body"))?;
        if chunk.len() > MAX_BODY_BYTES - bytes.len() {
            return Err(ApiError::Client(413, "Request body exceeds 65536 bytes"));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| ApiError::Client(400, "Invalid JSON payload"))
}

async fn get_clipboard(env: &Env) -> ApiResult<Response> {
    let value = env
        .d1("DB")?
        .prepare(include_str!("../sql/get_clipboard.sql"))
        .first::<Clipboard>(None)
        .await?
        .ok_or(ApiError::Client(404, "No content found"))?;
    Ok(Response::from_json(&value)?)
}

async fn put_clipboard(request: &mut Request, env: &Env) -> ApiResult<Response> {
    let value: Clipboard = read_json(request).await?;
    domain::validate_text(&value.text).map_err(|error| ApiError::Client(400, error))?;
    env.d1("DB")?
        .prepare(include_str!("../sql/put_clipboard.sql"))
        .bind(&[JsValue::from_str(&value.text)])?
        .run()
        .await?;
    Ok(Response::empty()?.with_status(204))
}

async fn put_link(request: &mut Request, env: &Env) -> ApiResult<Response> {
    let mut link: ShortLink = read_json(request).await?;
    link.url = domain::normalise_url(&link.url).map_err(|error| ApiError::Client(400, error))?;
    let db = env.d1("DB")?;
    if !link.shorten.is_empty() {
        if !domain::valid_code(&link.shorten) {
            return Err(ApiError::Client(400, "Invalid or reserved short code"));
        }
        let saved = db
            .prepare(include_str!("../sql/upsert_link.sql"))
            .bind(&[
                JsValue::from_str(&link.shorten),
                JsValue::from_str(&link.url),
            ])?
            .first::<ShortLink>(None)
            .await?
            .ok_or(ApiError::Client(500, "Short link was not saved"))?;
        return Ok(Response::from_json(&saved)?);
    }
    // Collisions retry an atomic INSERT, never an overwrite or a read-then-write.
    for _ in 0..8 {
        let mut bytes = [0; 8];
        getrandom::fill(&mut bytes)
            .map_err(|_| ApiError::Client(503, "Random source unavailable"))?;
        link.shorten = domain::random_code(bytes);
        let inserted = db
            .prepare(include_str!("../sql/insert_link.sql"))
            .bind(&[
                JsValue::from_str(&link.shorten),
                JsValue::from_str(&link.url),
            ])?
            .first::<String>(Some("shorten"))
            .await?;
        if inserted.is_some() {
            return Ok(Response::from_json(&link)?);
        }
    }
    Err(ApiError::Client(
        503,
        "Could not allocate a short code; retry",
    ))
}

async fn list_links(request: &Request, env: &Env) -> ApiResult<Response> {
    let url = request.url()?;
    let page = domain::parse_page(url.query()).map_err(|error| ApiError::Client(400, error))?;
    let mut links = env
        .d1("DB")?
        .prepare(include_str!("../sql/list_links.sql"))
        .bind(&[
            JsValue::from_str(&page.after),
            JsValue::from_f64((page.limit + 1) as f64),
        ])?
        .all()
        .await?
        .results::<ShortLink>()?;
    let more = links.len() > page.limit;
    links.truncate(page.limit);
    let mut response = Response::from_json(&links)?;
    if more && let Some(last) = links.last() {
        response.headers_mut().set("X-Next-Cursor", &last.shorten)?;
    }
    Ok(response)
}

async fn delete_link(code: &str, env: &Env) -> ApiResult<Response> {
    let deleted = env
        .d1("DB")?
        .prepare(include_str!("../sql/delete_link.sql"))
        .bind(&[JsValue::from_str(code)])?
        .first::<String>(Some("shorten"))
        .await?;
    if deleted.is_none() {
        return Err(ApiError::Client(404, "Not found"));
    }
    Ok(Response::empty()?.with_status(204))
}

async fn redirect(code: &str, env: &Env) -> ApiResult<Response> {
    let target = env
        .d1("DB")?
        .prepare(include_str!("../sql/get_link.sql"))
        .bind(&[JsValue::from_str(code)])?
        .first::<String>(Some("url"))
        .await?
        .ok_or(ApiError::Client(404, "Not found"))?;
    // No cache or read replica: edits/deletions are visible on the next request.
    let mut response = Response::empty()?.with_status(302);
    response.headers_mut().set("Location", &target)?;
    Ok(response)
}
