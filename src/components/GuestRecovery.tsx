import {Link} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {GuestError} from '@/lib/guestApplication';

export function GuestRecovery({error,retry}:{error:Error;retry:()=>void}){
 const terminal=error instanceof GuestError&&error.status===401;
 return <section role="alert" className="container py-12 space-y-4">
  <p>{error.message}</p>
  {terminal?<Button asChild><Link to="/join">Rejoin event</Link></Button>:<Button onClick={retry}>Retry</Button>}
 </section>;
}