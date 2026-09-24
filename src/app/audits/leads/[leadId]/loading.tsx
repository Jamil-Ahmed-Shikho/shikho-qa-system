import { LoadingPanel } from '@/components/common/LoadingPanel'

export default function Loading() {
  return <LoadingPanel title="Finding this lead's calls…" detail="Fetching from the CRM and checking each call's audit status." />
}
