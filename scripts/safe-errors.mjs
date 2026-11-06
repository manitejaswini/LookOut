// Import this FIRST in any script that talks to Arkiv. A network error would otherwise print the RPC URL, which contains the access key.
import { installErrorScrubbing } from '@lookout/arkiv';
installErrorScrubbing();
