//! Shared HTTP client. Every request gets connect/read timeouts so a stalled
//! connection fails with an error instead of leaving a job spinning forever.

use std::sync::OnceLock;
use std::time::Duration;

/// Upper bound for small API calls (catalog, covers); large tool downloads rely on the read timeout.
pub const API_TIMEOUT: Duration = Duration::from_secs(20);

pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Muse/0.1 (personal music player)")
            .connect_timeout(Duration::from_secs(10))
            // Time allowed between received chunks, not for the whole body
            .read_timeout(Duration::from_secs(30))
            .build()
            .expect("HTTP client")
    })
}

pub async fn get(url: &str) -> reqwest::Result<reqwest::Response> {
    client().get(url).timeout(API_TIMEOUT).send().await?.error_for_status()
}
