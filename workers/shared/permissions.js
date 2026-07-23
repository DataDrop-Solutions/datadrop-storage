// ============================================================
// DataDrop — Unified Permission Engine
// All ACL decisions go through resolvePermission().
// No permission logic lives in individual handlers.
// ============================================================

export const CONTEXT = {
  PERSONAL:  'personal',
  SHARE:     'share',
  WORKSPACE: 'workspace',
};

export const ROLE = {
  READ:   'read',
  UPLOAD: 'upload',
  FULL:   'full',
  ADMIN:  'admin',
  OWNER:  'owner',
};

const UPLOAD_ROLES = new Set([ROLE.UPLOAD, ROLE.FULL, ROLE.ADMIN, ROLE.OWNER]);
const MANAGE_ROLES = new Set([ROLE.FULL, ROLE.ADMIN, ROLE.OWNER]);
const ADMIN_ROLES  = new Set([ROLE.ADMIN, ROLE.OWNER]);

export const canUpload = (role) => UPLOAD_ROLES.has(role);
export const canManage = (role) => MANAGE_ROLES.has(role);
export const canAdmin  = (role) => ADMIN_ROLES.has(role);

// ── Resolve what a user can do with a specific file ──────────
// Returns null if the user has no access at all.
// Returns a permission object describing what they can do.
export async function resolveFilePermission(env, userId, fileId) {
  const file = await env.DB.prepare(
    `SELECT f.id, f.user_id, f.team_id, f.is_vault, f.accessible,
            tm.role as team_role, t.owner_id as team_owner_id
     FROM files f
     LEFT JOIN team_members tm
       ON tm.team_id = f.team_id AND tm.user_id = ? AND tm.status = 'active'
     LEFT JOIN teams t ON t.id = f.team_id
     WHERE f.id = ? AND f.deleted_at IS NULL`
  ).bind(userId, fileId).first();

  if (!file) return null;
  if (!file.accessible) return null;

  // Owner of the file
  if (file.user_id === userId) {
    return {
      context:     CONTEXT.PERSONAL,
      role:        ROLE.OWNER,
      canView:     true,
      canDownload: true,
      canDelete:   true,
      canShare:    !file.is_vault,
      canEdit:     true,
    };
  }

  // Workspace member
  if (file.team_id) {
    // Team owner always has full access
    const effectiveRole = file.team_owner_id === userId ? ROLE.OWNER : file.team_role;
    if (!effectiveRole) return null;
    return {
      context:     CONTEXT.WORKSPACE,
      role:        effectiveRole,
      canView:     true,
      canDownload: canUpload(effectiveRole),
      canDelete:   canManage(effectiveRole),
      canShare:    false,
      canEdit:     canManage(effectiveRole),
    };
  }

  // Share recipient
  const share = await env.DB.prepare(
    `SELECT can_view, can_download, can_save, expires_at, max_views, views_used
     FROM shares
     WHERE file_id = ? AND recipient_user_id = ? AND status = 'active'
     LIMIT 1`
  ).bind(fileId, userId).first();

  if (share) {
    if (share.expires_at && Date.now() > share.expires_at) return null;
    if (share.max_views && share.views_used >= share.max_views) return null;
    return {
      context:     CONTEXT.SHARE,
      role:        ROLE.READ,
      canView:     !!share.can_view,
      canDownload: !!share.can_download,
      canDelete:   false,
      canShare:    false,
      canEdit:     false,
      canSave:     !!share.can_save,
    };
  }

  return null;
}

// ── Resolve workspace membership ──────────────────────────────
export async function resolveTeamPermission(env, teamId, userId) {
  const team = await env.DB.prepare(
    'SELECT id, owner_id FROM teams WHERE id = ?'
  ).bind(teamId).first();

  if (!team) return null;
  if (team.owner_id === userId) return { team, role: ROLE.OWNER };

  const mem = await env.DB.prepare(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'"
  ).bind(teamId, userId).first();

  if (!mem) return null;
  return { team, role: mem.role };
}

// ── Resolve billing user for a file ──────────────────────────
// Workspace files are billed to the team owner, not the uploader.
export async function resolveBillingUserId(env, file) {
  if (!file.team_id) return file.user_id;
  const team = await env.DB.prepare(
    'SELECT owner_id FROM teams WHERE id = ?'
  ).bind(file.team_id).first();
  return team?.owner_id || file.user_id;
}
