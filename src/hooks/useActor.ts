import {useAuth} from '@/contexts/auth-state';
import {useGuest} from '@/contexts/guest-state';
export function useActor(){const auth=useAuth(),guest=useGuest();const fresh=!auth.user&&guest?.enabled&&guest.session;
 return {kind:auth.user?'auth' as const:fresh?'guest' as const:'none' as const,id:auth.user?.id??(fresh?guest.session?.principal_id:undefined),profile:auth.user?auth.profile:guest?.snapshot?.profile??null,isDJ:!!auth.user&&auth.isDJ,isAnonymous:auth.user?auth.isAnonymous:!!fresh,loading:auth.loading,auth,guest:fresh?guest:null};}