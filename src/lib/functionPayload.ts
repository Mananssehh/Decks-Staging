export interface FunctionPayload {
 url?:string; ready?:boolean; message?:string; error?:string; error_code?:string;
 stripe_error?: {http_status?:number;stripe_type?:string;stripe_code?:string;message?:string;request_id?:string};
}
export function functionContext(error:unknown): Response | undefined {
  if(typeof error !== 'object'||error===null||!('context' in error))return undefined;
  return error.context instanceof Response ? error.context : undefined;
}