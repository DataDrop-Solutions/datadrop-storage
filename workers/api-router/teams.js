// ============================================================
// DataDrop — Teams API
// Routes: /teams/*
// ============================================================

import { corsResponse, newId, sendEmail } from '../shared/utils.js';

export async function handleTeams(request, env, session) {
  const url  = new URL(request.url);
  const path = url.pathname.replace('/teams', '');

  // Accept invite by token
  const acceptMatch = path.match(/^\/invites\/([^/]+)\/accept$/);
  if (acceptMatch && request.method === 'POST') return acceptInvite(acceptMatch[1], env, session);

  // List pending invites for logged-in user
  if (path === '/invites' && request.method === 'GET') return listInvites(env, session);

  // CRUD
  if (path === '' && request.method === 'GET')  return listTeams(env, session);
  if (path === '' && request.method === 'POST') return createTeam(request, env, session);

  const teamMatch = path.match(/^\/([^/]+)$/);
  if (teamMatch) {
    const teamId = teamMatch[1];
    if (request.method === 'GET')    return getTeam(teamId, env, session);
    if (request.method === 'DELETE') return dissolveTeam(teamId, env, session);
  }

  const inviteMatch = path.match(/^\/([^/]+)\/invite$/);
  if (inviteMatch && request.method === 'POST') return inviteMember(inviteMatch[1], request, env, session);

  const leaveMatch = path.match(/^\/([^/]+)\/leave$/);
  if (leaveMatch && request.method === 'DELETE') return leaveTeam(leaveMatch[1], env, session);

  const memberMatch = path.match(/^\/([^/]+)\/members\/([^/]+)$/);
  if (memberMatch) {
    const [, teamId, memberId] = memberMatch;
    if (request.method === 'PUT')    return changeMemberRole(teamId, memberId, request, env, session);
    if (request.method === 'DELETE') return removeMember(teamId, memberId, env, session);
  }

  // ── Team workspace file routes ──────────────────────────────
  const teamFilesMatch = path.match(/^\/([^/]+)\/files$/);
  if (teamFilesMatch && request.method === 'GET') return listTeamFiles(teamFilesMatch[1], request, env, session);

  const teamFolderMatch = path.match(/^\/([^/]+)\/files\/folder$/);
  if (teamFolderMatch && request.method === 'POST') return createTeamFolder(teamFolderMatch[1], request, env, session);

  const teamFolderIdMatch = path.match(/^\/([^/]+)\/files\/folder\/([^/]+)$/);
  if (teamFolderIdMatch && request.method === 'DELETE') return deleteTeamFolder(teamFolderIdMatch[1], teamFolderIdMatch[2], env, session);

  const teamFileIdMatch = path.match(/^\/([^/]+)\/files\/([^/]+)$/);
  if (teamFileIdMatch && request.method === 'DELETE') return deleteTeamFile(teamFileIdMatch[1], teamFileIdMatch[2], env, session);
  if (teamFileIdMatch && request.method === 'GET')    return getTeamFile(teamFileIdMatch[1], teamFileIdMatch[2], env, session);
  if (teamFileIdMatch && request.method === 'PUT')    return promoteTeamFileVersion(teamFileIdMatch[1], teamFileIdMatch[2], request, env, session);

  const teamFileVersionsMatch = path.match(/^\/([^/]+)\/files\/([^/]+)\/versions$/);
  if (teamFileVersionsMatch && request.method === 'GET') return listTeamFileVersions(teamFileVersionsMatch[1], teamFileVersionsMatch[2], env, session);

  // Team ECDH key distribution
  const teamKeysMatch = path.match(/^\/([^/]+)\/keys$/);
  if (teamKeysMatch && request.method === 'POST') return storeTeamKey(teamKeysMatch[1], request, env, session);
  if (teamKeysMatch && request.method === 'GET')  return listTeamKeys(teamKeysMatch[1], env, session);

  const teamKeyUserMatch = path.match(/^\/([^/]+)\/keys\/([^/]+)$/);
  if (teamKeyUserMatch && request.method === 'GET')    return getTeamKey(teamKeyUserMatch[1], teamKeyUserMatch[2], env, session);
  if (teamKeyUserMatch && request.method === 'DELETE') return revokeTeamKey(teamKeyUserMatch[1], teamKeyUserMatch[2], env, session);

  return corsResponse({ error: 'Not found' }, 404);
}

// Valid non-owner roles (in ascending permission order)
const VALID_ROLES = ['read', 'upload', 'full', 'admin'];

// ── Membership check helper ───────────────────────────────────
async function checkMembership(teamId, uid, env) {
  const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) return null;
  if (team.owner_id === uid) return { team, role: 'owner', isMember: true };
  const mem = await env.DB.prepare(
    "SELECT role FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'"
  ).bind(teamId, uid).first();
  if (!mem) return null;
  return { team, role: mem.role, isMember: true };
}

function canUpload(role)  { return ['upload', 'full', 'admin', 'owner'].includes(role); }
function canManage(role)  { return ['full', 'admin', 'owner'].includes(role); }
function canAdmin(role)   { return ['admin', 'owner'].includes(role); }

// ── List teams user belongs to ────────────────────────────────
async function listTeams(env, session) {
  const uid = session.userId;

  const { results: owned } = await env.DB.prepare(`
    SELECT t.id, t.name, t.owner_id, t.created_at,
           (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id AND tm.status = 'active') as member_count
    FROM teams t WHERE t.owner_id = ?
    ORDER BY t.created_at DESC
  `).bind(uid).all();

  const { results: joined } = await env.DB.prepare(`
    SELECT t.id, t.name, t.owner_id, t.created_at, tm.role, tm.status,
           (SELECT COUNT(*) FROM team_members tm2 WHERE tm2.team_id = t.id AND tm2.status = 'active') as member_count
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ? AND tm.status = 'active' AND t.owner_id != ?
    ORDER BY t.created_at DESC
  `).bind(uid, uid).all();

  const teams = [
    ...owned.map(t => ({ ...t, role: 'owner', status: 'active' })),
    ...joined,
  ];

  return corsResponse({ teams });
}

// ── Create team ───────────────────────────────────────────────
async function createTeam(request, env, session) {
  const { name, keySalt } = await request.json();
  if (!name?.trim()) return corsResponse({ error: 'name required' }, 400);
  if (!keySalt)      return corsResponse({ error: 'keySalt required' }, 400);

  const uid    = session.userId;
  const teamId = newId();
  const now    = Date.now();

  await env.DB.prepare(`
    INSERT INTO teams (id, name, owner_id, key_salt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(teamId, name.trim(), uid, keySalt, now, now).run();

  await env.DB.prepare(`
    INSERT INTO team_members (id, team_id, user_id, role, status, invited_by, joined_at)
    VALUES (?, ?, ?, 'admin', 'active', ?, ?)
  `).bind(newId(), teamId, uid, uid, now).run();

  return corsResponse({ teamId, name: name.trim() }, 201);
}

// ── Get team detail ───────────────────────────────────────────
async function getTeam(teamId, env, session) {
  const uid  = session.userId;
  const mem  = await checkMembership(teamId, uid, env);
  if (!mem) return corsResponse({ error: 'Forbidden' }, 403);

  const { team } = mem;

  const { results: members } = await env.DB.prepare(`
    SELECT tm.id, tm.user_id, tm.role, tm.status, tm.invited_by, tm.joined_at,
           u.email, u.display_name, u.username
    FROM team_members tm
    LEFT JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ? AND tm.status = 'active'
    ORDER BY tm.joined_at ASC
  `).bind(teamId).all();

  const { results: pendingInvites } = await env.DB.prepare(`
    SELECT id, invited_email, invited_user_id, invited_by, created_at, expires_at
    FROM team_invites WHERE team_id = ? AND status = 'pending'
    ORDER BY created_at DESC
  `).bind(teamId).all();

  return corsResponse({
    team: { ...team, key_salt: team.key_salt },
    members,
    pendingInvites,
    isOwner: team.owner_id === uid,
  });
}

// ── Team workspace: list files & folders ─────────────────────
async function listTeamFiles(teamId, request, env, session) {
  const mem = await checkMembership(teamId, session.userId, env);
  if (!mem) return corsResponse({ error: 'Forbidden' }, 403);

  const url      = new URL(request.url);
  const folderId = url.searchParams.get('folderId') || null;

  const { results: folders } = await env.DB.prepare(`
    SELECT id, name, parent_id, created_at
    FROM folders
    WHERE team_id = ? AND ${folderId ? 'parent_id = ?' : 'parent_id IS NULL'}
    ORDER BY name ASC
  `).bind(...(folderId ? [teamId, folderId] : [teamId])).all();

  const { results: files } = await env.DB.prepare(`
    SELECT f.id, f.filename, f.mime_type, f.size_bytes, f.created_at, f.is_encrypted, f.version_number, f.thumb_data,
           f.user_id as uploaded_by_id,
           u.display_name as uploaded_by_name, u.username as uploaded_by_username,
           (SELECT COUNT(*) FROM files v WHERE v.version_of = f.id AND v.deleted_at IS NULL) AS archived_count
    FROM files f
    LEFT JOIN users u ON u.id = f.user_id
    WHERE f.team_id = ? AND f.folder_id ${folderId ? '= ?' : 'IS NULL'}
      AND f.deleted_at IS NULL AND f.accessible = 1 AND f.version_of IS NULL
    ORDER BY f.created_at DESC
  `).bind(...(folderId ? [teamId, folderId] : [teamId])).all();

  return corsResponse({ folders, files });
}

// ── Team workspace: create folder ────────────────────────────
async function createTeamFolder(teamId, request, env, session) {
  const mem = await checkMembership(teamId, session.userId, env);
  if (!mem || !canManage(mem.role)) return corsResponse({ error: 'Forbidden' }, 403);

  const { name, parentId } = await request.json();
  if (!name?.trim()) return corsResponse({ error: 'name required' }, 400);

  // Uniqueness check within same parent
  const duplicate = await env.DB.prepare(
    `SELECT id FROM folders WHERE team_id = ? AND name = ? AND parent_id ${parentId ? '= ?' : 'IS NULL'}`
  ).bind(...(parentId ? [teamId, name.trim(), parentId] : [teamId, name.trim()])).first();
  if (duplicate) return corsResponse({ error: 'A folder with this name already exists' }, 409);

  const folderId = newId();
  const now      = Date.now();

  await env.DB.prepare(`
    INSERT INTO folders (id, user_id, team_id, name, parent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(folderId, session.userId, teamId, name.trim(), parentId || null, now, now).run();

  return corsResponse({ folderId, name: name.trim() }, 201);
}

// ── Team workspace: delete folder ────────────────────────────
async function deleteTeamFolder(teamId, folderId, env, session) {
  const mem = await checkMembership(teamId, session.userId, env);
  if (!mem || !canManage(mem.role)) return corsResponse({ error: 'Forbidden' }, 403);

  const folder = await env.DB.prepare(
    'SELECT id FROM folders WHERE id = ? AND team_id = ?'
  ).bind(folderId, teamId).first();
  if (!folder) return corsResponse({ error: 'Folder not found' }, 404);

  await env.DB.prepare('DELETE FROM folders WHERE id = ? AND team_id = ?').bind(folderId, teamId).run();
  return corsResponse({ success: true });
}

// ── Team workspace: get single file info ─────────────────────
async function getTeamFile(teamId, fileId, env, session) {
  const mem = await checkMembership(teamId, session.userId, env);
  if (!mem) return corsResponse({ error: 'Forbidden' }, 403);

  const file = await env.DB.prepare(
    'SELECT id, filename, mime_type, size_bytes FROM files WHERE id = ? AND team_id = ? AND deleted_at IS NULL'
  ).bind(fileId, teamId).first();
  if (!file) return corsResponse({ error: 'File not found' }, 404);

  return corsResponse({ file });
}

// ── Team workspace: soft-delete file ─────────────────────────
async function deleteTeamFile(teamId, fileId, env, session) {
  const mem = await checkMembership(teamId, session.userId, env);
  if (!mem || !canManage(mem.role)) return corsResponse({ error: 'Forbidden' }, 403);

  const file = await env.DB.prepare(
    'SELECT id, size_bytes FROM files WHERE id = ? AND team_id = ? AND deleted_at IS NULL'
  ).bind(fileId, teamId).first();
  if (!file) return corsResponse({ error: 'File not found' }, 404);

  const now     = Date.now();
  const expires = now + 30 * 86400000;
  await env.DB.prepare(
    'UPDATE files SET deleted_at = ?, trash_expires_at = ? WHERE id = ?'
  ).bind(now, expires, fileId).run();

  return corsResponse({ success: true });
}

// ── Team workspace: list file versions ───────────────────────
async function listTeamFileVersions(teamId, fileId, env, session) {
  const mem = await checkMembership(teamId, session.userId, env);
  if (!mem) return corsResponse({ error: 'Forbidden' }, 403);

  const { results: versions } = await env.DB.prepare(
    `SELECT f.id, f.filename, f.mime_type, f.size_bytes, f.version_number, f.created_at,
            u.display_name as uploaded_by_name, u.username as uploaded_by_username
     FROM files f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.version_of = ?
     ORDER BY f.version_number ASC`
  ).bind(fileId).all();

  return corsResponse({ versions });
}

// ── Team workspace: version promote ──────────────────────────
async function promoteTeamFileVersion(teamId, fileId, request, env, session) {
  const mem = await checkMembership(teamId, session.userId, env);
  if (!mem || !canUpload(mem.role)) return corsResponse({ error: 'Forbidden' }, 403);

  const { promoteFrom } = await request.json();
  if (!promoteFrom) return corsResponse({ error: 'promoteFrom required' }, 400);

  const canonical = await env.DB.prepare(
    'SELECT id, storage_key, size_bytes, size_gb, bucket, mime_type, hash_sha256, version_number, filename FROM files WHERE id = ? AND team_id = ? AND deleted_at IS NULL'
  ).bind(fileId, teamId).first();
  if (!canonical) return corsResponse({ error: 'File not found' }, 404);

  const newFile = await env.DB.prepare(
    'SELECT storage_key, size_bytes, size_gb, bucket, mime_type, hash_sha256 FROM files WHERE id = ? AND deleted_at IS NULL'
  ).bind(promoteFrom).first();
  if (!newFile) return corsResponse({ error: 'Source file not found' }, 404);

  const now    = Date.now();
  const oldNum = canonical.version_number || 1;

  // Archive canonical content into the new-file record (mark as old version)
  await env.DB.prepare(`
    UPDATE files SET
      storage_key = ?, size_bytes = ?, size_gb = ?, bucket = ?,
      mime_type = ?, hash_sha256 = ?, filename = ?,
      version_of = ?, version_number = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    canonical.storage_key, canonical.size_bytes, canonical.size_gb, canonical.bucket,
    canonical.mime_type, canonical.hash_sha256, canonical.filename,
    fileId, oldNum, now, promoteFrom
  ).run();

  // Promote new content onto the canonical record
  await env.DB.prepare(`
    UPDATE files SET
      storage_key = ?, size_bytes = ?, size_gb = ?, bucket = ?,
      mime_type = COALESCE(?, mime_type), hash_sha256 = ?,
      version_number = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    newFile.storage_key, newFile.size_bytes, newFile.size_gb, newFile.bucket,
    newFile.mime_type, newFile.hash_sha256,
    oldNum + 1, now, fileId
  ).run();

  return corsResponse({ success: true, versioned: true });
}

// ── Invite member ─────────────────────────────────────────────
async function inviteMember(teamId, request, env, session) {
  const uid  = session.userId;
  const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) return corsResponse({ error: 'Team not found' }, 404);

  if (team.owner_id !== uid) {
    const mem = await env.DB.prepare(
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'"
    ).bind(teamId, uid).first();
    if (!mem || mem.role !== 'admin') return corsResponse({ error: 'Forbidden' }, 403);
  }

  const { emailOrUsername, role: inviteRole = 'upload' } = await request.json();
  if (!emailOrUsername?.trim()) return corsResponse({ error: 'emailOrUsername required' }, 400);
  if (!VALID_ROLES.includes(inviteRole)) return corsResponse({ error: 'Invalid role' }, 400);

  const target = await env.DB.prepare(
    "SELECT id, email, display_name FROM users WHERE email = ? OR username = ? AND deleted_at IS NULL LIMIT 1"
  ).bind(emailOrUsername.trim(), emailOrUsername.trim()).first();

  const now     = Date.now();
  const expires = now + 7 * 86400000;
  const token   = crypto.randomUUID();
  const inviteId = newId();

  if (target) {
    const existing = await env.DB.prepare(
      "SELECT id FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'"
    ).bind(teamId, target.id).first();
    if (existing) return corsResponse({ error: 'User is already a team member' }, 409);

    const existingInvite = await env.DB.prepare(
      "SELECT id FROM team_invites WHERE team_id = ? AND invited_user_id = ? AND status = 'pending'"
    ).bind(teamId, target.id).first();
    if (existingInvite) return corsResponse({ error: 'User already has a pending invite' }, 409);

    await env.DB.prepare(`
      INSERT INTO team_invites (id, team_id, invited_email, invited_user_id, invited_by, token, role, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(inviteId, teamId, target.email, target.id, uid, token, inviteRole, now, expires).run();

    const inviter = await env.DB.prepare('SELECT display_name FROM users WHERE id = ?').bind(uid).first();
    await sendEmail(env, {
      to: target.email,
      subject: `${inviter?.display_name || 'Someone'} invited you to join "${team.name}" on DataDrop`,
      html: `<p>Hi ${target.display_name},</p>
        <p><strong>${inviter?.display_name || 'A DataDrop user'}</strong> has invited you to join the team <strong>"${team.name}"</strong>.</p>
        <p><a href="https://app.datadrop.co.in/teams?token=${token}" style="background:#6366f1;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">Accept Invitation →</a></p>
        <p style="color:#888;font-size:12px">This invite expires in 7 days. If you didn't expect this, you can ignore this email.</p>`,
    });

    return corsResponse({ success: true, invited: target.email });
  } else {
    const email = emailOrUsername.includes('@') ? emailOrUsername.trim() : null;
    if (!email) return corsResponse({ error: 'User not found. Use email to invite someone without an account.' }, 404);

    const existingInvite = await env.DB.prepare(
      "SELECT id FROM team_invites WHERE team_id = ? AND invited_email = ? AND status = 'pending'"
    ).bind(teamId, email).first();
    if (existingInvite) return corsResponse({ error: 'Email already invited' }, 409);

    await env.DB.prepare(`
      INSERT INTO team_invites (id, team_id, invited_email, invited_user_id, invited_by, token, role, status, created_at, expires_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?, 'pending', ?, ?)
    `).bind(inviteId, teamId, email, uid, token, inviteRole, now, expires).run();

    const inviter = await env.DB.prepare('SELECT display_name FROM users WHERE id = ?').bind(uid).first();
    await sendEmail(env, {
      to: email,
      subject: `You've been invited to join "${team.name}" on DataDrop`,
      html: `<p><strong>${inviter?.display_name || 'A DataDrop user'}</strong> has invited you to join the team <strong>"${team.name}"</strong> on DataDrop.</p>
        <p><a href="https://app.datadrop.co.in/teams?token=${token}" style="background:#6366f1;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">Accept Invitation →</a></p>
        <p>If you don't have a DataDrop account, you'll be prompted to create one.</p>
        <p style="color:#888;font-size:12px">This invite expires in 7 days.</p>`,
    });

    return corsResponse({ success: true, invited: email });
  }
}

// ── Accept invite ─────────────────────────────────────────────
async function acceptInvite(token, env, session) {
  const uid    = session.userId;
  const invite = await env.DB.prepare(
    "SELECT * FROM team_invites WHERE token = ? AND status = 'pending'"
  ).bind(token).first();

  if (!invite) return corsResponse({ error: 'Invalid or expired invite' }, 404);
  if (Date.now() > invite.expires_at) {
    await env.DB.prepare("UPDATE team_invites SET status = 'expired' WHERE id = ?").bind(invite.id).run();
    return corsResponse({ error: 'Invite has expired' }, 410);
  }

  if (invite.invited_user_id && invite.invited_user_id !== uid) {
    return corsResponse({ error: 'This invite was not sent to your account' }, 403);
  }

  const now = Date.now();
  const memberRole = invite.role || 'upload';
  await env.DB.prepare(`
    INSERT OR IGNORE INTO team_members (id, team_id, user_id, role, status, invited_by, joined_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).bind(newId(), invite.team_id, uid, memberRole, invite.invited_by, now).run();

  await env.DB.prepare("UPDATE team_invites SET status = 'accepted' WHERE id = ?").bind(invite.id).run();

  const team = await env.DB.prepare('SELECT id, name FROM teams WHERE id = ?').bind(invite.team_id).first();
  return corsResponse({ success: true, teamId: invite.team_id, teamName: team?.name });
}

// ── List pending invites for current user ─────────────────────
async function listInvites(env, session) {
  const uid  = session.userId;
  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(uid).first();

  const { results } = await env.DB.prepare(`
    SELECT ti.id, ti.team_id, ti.token, ti.created_at, ti.expires_at,
           t.name as team_name, u.display_name as inviter_name
    FROM team_invites ti
    JOIN teams t ON t.id = ti.team_id
    LEFT JOIN users u ON u.id = ti.invited_by
    WHERE (ti.invited_user_id = ? OR ti.invited_email = ?) AND ti.status = 'pending' AND ti.expires_at > ?
    ORDER BY ti.created_at DESC
  `).bind(uid, user?.email || '', Date.now()).all();

  return corsResponse({ invites: results });
}

// ── Change member role ────────────────────────────────────────
async function changeMemberRole(teamId, memberId, request, env, session) {
  const uid  = session.userId;
  const team = await env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(teamId).first();
  if (!team || team.owner_id !== uid) return corsResponse({ error: 'Only owner can change roles' }, 403);

  const { role } = await request.json();
  if (!VALID_ROLES.includes(role)) return corsResponse({ error: 'Invalid role' }, 400);

  await env.DB.prepare(
    "UPDATE team_members SET role = ? WHERE id = ? AND team_id = ?"
  ).bind(role, memberId, teamId).run();

  return corsResponse({ success: true });
}

// ── Remove member ─────────────────────────────────────────────
async function removeMember(teamId, memberId, env, session) {
  const uid  = session.userId;
  const team = await env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) return corsResponse({ error: 'Team not found' }, 404);

  if (team.owner_id !== uid) {
    const caller = await env.DB.prepare(
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'"
    ).bind(teamId, uid).first();
    if (!caller || caller.role !== 'admin') return corsResponse({ error: 'Forbidden' }, 403);
  }

  const member = await env.DB.prepare('SELECT user_id FROM team_members WHERE id = ? AND team_id = ?').bind(memberId, teamId).first();
  if (!member) return corsResponse({ error: 'Member not found' }, 404);
  if (member.user_id === team.owner_id) return corsResponse({ error: 'Cannot remove the team owner' }, 400);

  await env.DB.prepare("UPDATE team_members SET status = 'removed' WHERE id = ?").bind(memberId).run();
  return corsResponse({ success: true });
}

// ── Leave team ────────────────────────────────────────────────
async function leaveTeam(teamId, env, session) {
  const uid  = session.userId;
  const team = await env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) return corsResponse({ error: 'Team not found' }, 404);
  if (team.owner_id === uid) return corsResponse({ error: 'Owner cannot leave — dissolve the team instead' }, 400);

  await env.DB.prepare(
    "UPDATE team_members SET status = 'removed' WHERE team_id = ? AND user_id = ? AND status = 'active'"
  ).bind(teamId, uid).run();

  return corsResponse({ success: true });
}

// ── Dissolve team ─────────────────────────────────────────────
async function dissolveTeam(teamId, env, session) {
  const uid  = session.userId;
  const team = await env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(teamId).first();
  if (!team) return corsResponse({ error: 'Team not found' }, 404);
  if (team.owner_id !== uid) return corsResponse({ error: 'Only owner can dissolve the team' }, 403);

  await env.DB.prepare("UPDATE team_members SET status = 'removed' WHERE team_id = ?").bind(teamId).run();
  await env.DB.prepare("UPDATE team_invites SET status = 'expired' WHERE team_id = ? AND status = 'pending'").bind(teamId).run();
  await env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(teamId).run();

  return corsResponse({ success: true });
}

// ── ECDH Team Key distribution ────────────────────────────────
// POST /teams/:id/keys — store caller's encrypted copy of the team key
async function storeTeamKey(teamId, request, env, session) {
  const mem = await checkMembership(teamId, session.userId, env);
  if (!mem) return corsResponse({ error: 'Not a member' }, 403);

  const { encryptedTeamKey, ephemeralPublicKey, keyNonce, targetUserId } = await request.json();
  if (!encryptedTeamKey || !ephemeralPublicKey || !keyNonce) {
    return corsResponse({ error: 'encryptedTeamKey, ephemeralPublicKey, keyNonce required' }, 400);
  }

  const recipientId = targetUserId || session.userId;

  // Only owner/admin can distribute keys to others; members can only store their own key
  if (recipientId !== session.userId && !canAdmin(mem.role)) {
    return corsResponse({ error: 'Only admins can distribute team keys to other members' }, 403);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM team_keys WHERE team_id = ? AND user_id = ?'
  ).bind(teamId, recipientId).first();

  if (existing) {
    await env.DB.prepare(
      'UPDATE team_keys SET encrypted_team_key = ?, ephemeral_public_key = ?, key_nonce = ? WHERE id = ?'
    ).bind(encryptedTeamKey, ephemeralPublicKey, keyNonce, existing.id).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO team_keys (id, team_id, user_id, encrypted_team_key, ephemeral_public_key, key_nonce, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(newId(), teamId, recipientId, encryptedTeamKey, ephemeralPublicKey, keyNonce, Date.now()).run();
  }

  return corsResponse({ success: true });
}

// GET /teams/:id/keys — list all members who have a stored team key (admin only)
async function listTeamKeys(teamId, env, session) {
  const mem = await checkMembership(teamId, session.userId, env);
  if (!mem || !canAdmin(mem.role)) return corsResponse({ error: 'Forbidden' }, 403);

  const { results } = await env.DB.prepare(
    'SELECT user_id, created_at FROM team_keys WHERE team_id = ?'
  ).bind(teamId).all();

  return corsResponse({ keys: results });
}

// GET /teams/:id/keys/:userId — get encrypted team key for a specific user
async function getTeamKey(teamId, userId, env, session) {
  // Only the target user or team admin can retrieve a key
  const mem = await checkMembership(teamId, session.userId, env);
  if (!mem) return corsResponse({ error: 'Not a member' }, 403);
  if (userId !== session.userId && !canAdmin(mem.role)) {
    return corsResponse({ error: 'Forbidden' }, 403);
  }

  const row = await env.DB.prepare(
    'SELECT encrypted_team_key, ephemeral_public_key, key_nonce FROM team_keys WHERE team_id = ? AND user_id = ?'
  ).bind(teamId, userId).first();

  if (!row) return corsResponse({ error: 'Key not found' }, 404);

  return corsResponse({
    encrypted_team_key:  row.encrypted_team_key,
    ephemeral_public_key: row.ephemeral_public_key,
    key_nonce:           row.key_nonce,
  });
}

// DELETE /teams/:id/keys/:userId — revoke team key (admin only, used during member removal)
async function revokeTeamKey(teamId, userId, env, session) {
  const mem = await checkMembership(teamId, session.userId, env);
  if (!mem || !canAdmin(mem.role)) return corsResponse({ error: 'Forbidden' }, 403);

  await env.DB.prepare(
    'DELETE FROM team_keys WHERE team_id = ? AND user_id = ?'
  ).bind(teamId, userId).run();

  return corsResponse({ success: true });
}
