import React from 'react'

// P4 scope placeholder: people, action plans, approvals.
export default function Actions() {
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Actions</h1>
          <div className="sub">Decision owners, action plans, approval gates, exports.</div>
        </div>
      </div>
      <div className="card">
        <div className="empty">
          Action plans and approvals arrive in Phase 4 (alpha gate: a full plan on a real record).
          This screen will track: who owns the decision, what we send, what a human must approve before anything leaves.
        </div>
      </div>
    </div>
  )
}
