import type { Buffer } from "node:buffer";
// Response fields follow the published onepay OpenAPI 1.1.2. Optional fields vary by mode.
export type ApiErrorResponse = {
    "error": string;
    "error_code": string;
    "request_id": string;
    "retryable": boolean;
    "capability"?: string;
};
export type Buyer = {
    "user_id": string;
    "amount"?: number;
    "callback_url"?: string;
};
export type PurchaseBody = {
    "user_id": string;
    "idempotency_key": string;
    "sku_id"?: string;
    "callback_url"?: string;
};
export type Lookup = {
    "user_id": string;
    "idempotency_key": string;
};
export type ConsumeBody = {
    "user_id": string;
    "idempotency_key": string;
    "amount": number;
    "reason": string;
};
export type ListInput = {
    "user_id"?: string;
    "limit"?: number;
    "before_id"?: string;
};
export type WebhookInput = {
    "url": string;
    "enabled": boolean;
};
export type WebhookRead = {
    "configured": boolean;
    "url": string;
    "enabled": boolean;
    "updated_at"?: string;
};
export type WebhookSaved = {
    "configured": boolean;
    "url": string;
    "enabled": boolean;
    "secret"?: string;
};
export type WebhookSecret = {
    "secret": string;
};
export type Queued = {
    "queued": boolean;
};
export type ChargingOption = {
    "sku_id": string;
    "plan_id": string;
    "display_name": string;
    "billing_mode": "ONE_TIME" | "ONE_TIME_DURATION" | "QUANTITY";
    "price": string;
    "currency": string;
    "price_version": number;
    "entitlement_rule": "PERPETUAL" | "FIXED_DURATION" | "QUOTA";
    "duration_period"?: "WEEK" | "MONTH" | "QUARTER" | "YEAR";
    "quota_unit"?: "COUNT" | "POINT";
    "quota_amount"?: number;
    [key: string]: unknown;
};
export type Product = {
    "capability_status": "NOT_CONFIGURED" | "CONFIGURING" | "PENDING" | "ACTION_REQUIRED" | "ENABLED" | "DISABLED" | "TERMINATED";
    "product_name"?: string;
    "product_icon_url"?: string;
    "status_version"?: number | string;
    "billing_mode"?: "ONE_TIME" | "ONE_TIME_DURATION" | "QUANTITY" | "";
    "quota_unit"?: "COUNT" | "POINT";
    "charging_options": Array<ChargingOption>;
    "reason_message"?: string;
    [key: string]: unknown;
};
export type Access = {
    "access_granted": boolean;
    "requires_consumption"?: boolean;
    "decision"?: "ALLOW" | "PURCHASE_REQUIRED" | "DENY";
    "reason_code"?: string;
    "valid_from"?: string;
    "valid_until"?: string;
    "product_name"?: string;
    "product_icon_url"?: string;
    "capability_status"?: "NOT_CONFIGURED" | "CONFIGURING" | "PENDING" | "ACTION_REQUIRED" | "ENABLED" | "DISABLED" | "TERMINATED";
    "purchase_url"?: string;
    "purchase_qr_code"?: string;
    "charging_options"?: Array<ChargingOption>;
    "quota_unit"?: "COUNT" | "POINT";
    "total"?: number;
    "used"?: number;
    "remaining"?: number;
    "as_of_time"?: string;
    [key: string]: unknown;
};
export type Purchase = {
    "status": "READY" | "FAILED" | "UNKNOWN";
    "idempotency_key": string;
    "purchase_url"?: string;
    "purchase_qr_code"?: string;
    "expire_time"?: string;
    "charging_option"?: ChargingOption;
    "confirmed"?: boolean;
    "message"?: string;
    "reason_code"?: string;
    "consumed"?: number;
    [key: string]: unknown;
};
export type Consumption = {
    "status": "SUCCEEDED" | "FAILED" | "PROCESSING" | "UNKNOWN";
    "confirmed": boolean;
    "idempotency_key": string;
    "consume_status"?: string;
    "consume_order_id"?: string;
    "consume_reason"?: string;
    "quota_unit"?: "COUNT" | "POINT";
    "consumed"?: number;
    "remaining"?: number;
    "reason_code"?: string;
    "update_time"?: string;
    "message"?: string;
    [key: string]: unknown;
};
export type RequestResult = {
    "status"?: string;
    "idempotency_key"?: string;
    "purchase_url"?: string;
    "purchase_qr_code"?: string;
    "expire_time"?: string;
    "charging_option"?: ChargingOption;
    "confirmed"?: boolean;
    "message"?: string;
    "reason_code"?: string;
    "consumed"?: number;
    "consume_status"?: string;
    "consume_order_id"?: string;
    "consume_reason"?: string;
    "quota_unit"?: "COUNT" | "POINT";
    "remaining"?: number;
    "update_time"?: string;
    [key: string]: unknown;
};
export type PayRecord = {
    "id": string;
    "kind": "purchase" | "consume";
    "idempotency_key": string;
    "status": string;
    "user_id": string;
    "sku_id": string | null;
    "amount": string | null;
    "reason": string | null;
    "response": RequestResult;
    "expires_at": string | null;
    "created_at": string;
    "updated_at": string;
    "payment_status"?: "NOT_AVAILABLE";
    [key: string]: unknown;
};
export type RecordList = {
    "items": Array<PayRecord>;
    "has_more": boolean;
    "next_before_id": string;
};
export type EventData = {
    "billing_mode"?: "ONE_TIME" | "ONE_TIME_DURATION" | "QUANTITY";
    "decision"?: "ALLOW" | "PURCHASE_REQUIRED" | "DENY";
    "valid_from"?: string;
    "valid_until"?: string;
    "quota_unit"?: "COUNT" | "POINT";
    "total"?: number;
    "used"?: number;
    "remaining"?: number;
    "status"?: "SUCCEEDED" | "FAILED";
    "confirmed"?: boolean;
    "idempotency_key"?: string;
    "consume_status"?: string;
    "consume_order_id"?: string;
    "consume_reason"?: string;
    "consumed"?: number;
    "reason_code"?: string;
    "update_time"?: string;
    "message"?: string;
    [key: string]: unknown;
};
export type WebhookEvent = {
    "id": string;
    "type": "entitlement.observed" | "entitlement.updated" | "consumption.succeeded" | "consumption.failed";
    "project_id": string;
    "user_id": string;
    "created_at": string;
    "data": EventData;
};
export type EventRecord = {
    "id": string;
    "cursor_id": string;
    "event_type": "entitlement.observed" | "entitlement.updated" | "consumption.succeeded" | "consumption.failed";
    "user_id": string;
    "status": "PENDING" | "DELIVERING" | "DELIVERED" | "DEAD";
    "attempts": number;
    "last_http_status": number | null;
    "last_error": string;
    "created_at": string;
    "delivered_at": string | null;
    "next_attempt_at": string;
    "payload": WebhookEvent;
    [key: string]: unknown;
};
export type EventList = {
    "items": Array<EventRecord>;
    "has_more": boolean;
    "next_before_id": string;
};
export type CapabilityFlags = {
    "purchase_entry": boolean;
    "entitlement_query": boolean;
    "consumption": boolean;
    "purchase_request_query": boolean;
    "purchase_request_list": boolean;
    "consumption_list": boolean;
    "webhooks": boolean;
    "entitlement_monitoring": boolean;
    "transaction_query": boolean;
    "transaction_list": boolean;
    "refund": boolean;
    "refund_query": boolean;
    "bills": boolean;
    "automatic_renewal": boolean;
    "consumption_reversal": boolean;
};
export type Capabilities = {
    "api_version": string;
    "provider_configured": boolean;
    "capabilities": CapabilityFlags;
    "webhook_events": Array<"entitlement.observed" | "entitlement.updated" | "consumption.succeeded" | "consumption.failed">;
    "limitations": Array<string>;
};
export interface ClientOptions {
    apiKey?: string;
    baseURL?: string;
}
export interface PurchaseInput {
    userId: string;
    idempotencyKey: string;
    skuId?: string;
    callbackURL?: string;
}
export interface ConsumeInput {
    userId: string;
    idempotencyKey: string;
    amount?: number;
    reason: string;
}
export interface ListOptions {
    user_id?: string;
    before_id?: string;
    limit?: number;
}
export interface EventListOptions extends ListOptions {}
export class opcpayError extends Error {
    constructor(message: string, status: number, body: {
        error_code?: string;
        retryable?: boolean;
        [key: string]: unknown;
    }, requestId: string | null);
    status: number;
    code: string | undefined;
    requestId: string | null;
    retryable: boolean;
    body: {
        [key: string]: unknown;
    };
}
export class opcpay {
    constructor(options?: ClientOptions);
    request<T = unknown>(path: string, body?: unknown, method?: string): Promise<T>;
    capabilities(): Promise<Capabilities>;
    product(): Promise<Product>;
    access(userId: string, amount?: number): Promise<Access>;
    purchase(input: PurchaseInput): Promise<Purchase>;
    purchaseQuery(userId: string, idempotencyKey: string): Promise<PayRecord>;
    purchases(options?: ListOptions): Promise<RecordList>;
    consume(input: ConsumeInput): Promise<Consumption>;
    consumption(userId: string, idempotencyKey: string): Promise<Consumption>;
    consumptions(options?: ListOptions): Promise<RecordList>;
    webhook(): Promise<WebhookRead>;
    saveWebhook(url: string, enabled?: boolean): Promise<WebhookSaved>;
    rotateWebhook(): Promise<WebhookSecret>;
    events(options?: EventListOptions): Promise<EventList>;
    retryEvent(id: string): Promise<Queued>;
    /** Not available in the current service: rejects with HTTP 501. */
    transactionQuery(body: unknown): Promise<never>;
    transactions(body?: unknown): Promise<never>;
    refund(body: unknown): Promise<never>;
    refundQuery(body: unknown): Promise<never>;
    bills(body: unknown): Promise<never>;
}
export function verifyWebhook(rawBody: Buffer, headers: {
    [key: string]: string | string[] | undefined;
}, secret: string, now?: number): WebhookEvent;
