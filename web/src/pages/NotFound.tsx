import { ButtonLink, EmptyState } from '../components/ui'
import { useDocumentTitle } from '../lib/setup'

export default function NotFound() {
  useDocumentTitle('Not found')
  return (
    <div className="page">
      <EmptyState
        title="Nothing at this address"
        body="This route does not exist, but the control plane is still online. Jump back into the product — your runs and settings are untouched."
        action={
          <div className="empty__actions">
            <ButtonLink to="/">Return to overview</ButtonLink>
            <ButtonLink to="/new" variant="ghost">
              Start an automation
            </ButtonLink>
          </div>
        }
      />
    </div>
  )
}
