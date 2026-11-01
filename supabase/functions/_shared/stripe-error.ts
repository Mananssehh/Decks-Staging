export interface StripeErrorView {
 message?:string; statusCode?:number; requestId?:string; type?:string; code?:string; decline_code?:string; param?:string; doc_url?:string;
 raw?: {message?:string;statusCode?:number;request_log_url?:string;type?:string;code?:string;decline_code?:string;param?:string;doc_url?:string};
}