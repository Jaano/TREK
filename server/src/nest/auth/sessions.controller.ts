import { Controller, Delete, Get, HttpCode, HttpException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  userSessionRevokeParamsSchema,
  type UserSessionListResponse,
  type UserSessionRevokeOthersResponse,
  type UserSessionRevokeParams,
  type UserSessionRevokeResponse,
} from '@trek/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { clearAuthCookie } from '../common/cookie';
import { getClientIp } from '../audit/client-ip';
import { AuditService } from '../audit/audit.service';
import { SessionsService } from '../sessions/sessions.service';
import type { User } from '../../types';
import { CurrentUser } from './current-user.decorator';
import { currentSessionId } from './jwt-verify';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * The signed-in user's own sessions: where they are signed in, and signing
 * one or all the others out. Behind JwtAuthGuard like the other account
 * routes, and scoped to the caller: another user's session id answers 404,
 * exactly like one that does not exist.
 *
 * A request made with a token from before sessions were tracked sees no
 * current session (`current_tracked: false`). Signing out the others then
 * ends every tracked session, while that token itself runs on to its expiry.
 *
 * No MCP tool mirrors these routes: MCP exposes no account or session tools,
 * and a session is a browser credential an assistant has no business ending.
 */
@Controller('api/auth/sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: User, @Req() req: Request): Promise<UserSessionListResponse> {
    const current = currentSessionId(req);
    return { sessions: await this.sessions.list(user.id, current), current_tracked: current !== undefined };
  }

  // Static sub-route before the `:id` one.
  @Post('revoke-others')
  @HttpCode(200)
  async revokeOthers(@CurrentUser() user: User, @Req() req: Request): Promise<UserSessionRevokeOthersResponse> {
    const revoked = await this.sessions.revokeAll(user.id, currentSessionId(req));
    await this.audit.writeAudit({ userId: user.id, action: 'user.sessions_revoke_others', ip: getClientIp(req), details: { revoked } });
    return { success: true, revoked };
  }

  @Delete(':id')
  async revoke(
    @CurrentUser() user: User,
    @Param(new ZodValidationPipe(userSessionRevokeParamsSchema)) params: UserSessionRevokeParams,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserSessionRevokeResponse> {
    if (!(await this.sessions.revoke(user.id, params.id))) {
      throw new HttpException({ error: 'Session not found' }, 404);
    }
    // Ending the session this request came with is a logout: the cookie goes too.
    if (params.id === currentSessionId(req)) clearAuthCookie(res, req);
    await this.audit.writeAudit({ userId: user.id, action: 'user.session_revoke', ip: getClientIp(req), resource: params.id });
    return { success: true };
  }
}
