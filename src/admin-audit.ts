import { Controller, Get, Injectable, Req } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Auth } from './auth';
import { Database } from './database';

type Request = { headers: Record<string, string | undefined> };

// Call before COMMIT on the same connection as the administrative mutation.
export async function recordAdminAction(client:PoolClient,actorId:string,action:string,targetType:string,targetId:string,before:unknown,after:unknown) {
 await client.query(`INSERT INTO admin_audit(actor_id,action,target_type,target_id,changes)
  VALUES($1,$2,$3,$4,$5::jsonb)`, [actorId,action,targetType,targetId,JSON.stringify({before,after})]);
}

@Injectable()
export class AdminAudit {
 constructor(private readonly db:Database) {}
 async list() {
  const result=await this.db.pool.query(`SELECT a.id,a.action,a.target_type AS "targetType",a.target_id AS "targetId",
    a.changes,a.created_at AS "createdAt",u.display_name AS "displayName",u.email
    FROM admin_audit a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC`);
  return result.rows.map(row=>({id:Number(row.id),action:row.action,
   actor:{displayName:row.displayName,email:row.email},
   target:{type:row.targetType,id:row.targetId},changes:row.changes,createdAt:row.createdAt}));
 }
}

@Controller('api/admin/audit')
export class AdminAuditController {
 constructor(private readonly audit:AdminAudit,private readonly auth:Auth) {}
 @Get() async list(@Req() request:Request) {
  await this.auth.authenticate(request,'admin');
  return this.audit.list();
 }
}
