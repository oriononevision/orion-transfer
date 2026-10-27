import { handleComplete } from '../_shared/handlers.ts'
import { prodDeps } from '../_shared/prod.ts'

Deno.serve((req) => handleComplete(req, prodDeps()))
