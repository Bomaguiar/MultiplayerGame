-- T11/T12: customer requests (text + voice intake) with triage fields.
CREATE TABLE IF NOT EXISTS customer_requests (
    id             BIGSERIAL PRIMARY KEY,
    project_id     BIGINT REFERENCES projects(id) ON DELETE CASCADE,
    customer_phone TEXT NOT NULL,
    channel        TEXT NOT NULL DEFAULT 'text'
                   CHECK (channel IN ('text', 'voice')),
    raw_text       TEXT NOT NULL,                 -- original text, or transcript for voice
    media_ref      TEXT,                          -- storage key of the voice note (voice only)
    status         TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'triaged', 'resolved', 'closed')),
    category       TEXT
                   CHECK (category IN ('issue', 'question', 'change_request', 'scheduling', 'complaint')),
    urgency        TEXT
                   CHECK (urgency IN ('low', 'normal', 'high', 'urgent')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    triaged_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cust_req_project  ON customer_requests (project_id);
CREATE INDEX IF NOT EXISTS idx_cust_req_customer ON customer_requests (customer_phone);
CREATE INDEX IF NOT EXISTS idx_cust_req_status   ON customer_requests (status);
