import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { AgencyNode } from '../entities/agency-node.entity';

export const MAX_IMPORT_DEPTH = 20;

export interface PreCheckImportResult {
  action_type: 'DEPTH_BLOCKED' | 'SAME_PARENT' | 'SELF_IN_UPSTREAM' | 'NORMAL';
  prompt_msg?: string;
  parent_id?: string;
  service_id?: string;
}

@Injectable()
export class AgencyImportService {
  constructor(
    @InjectRepository(AgencyNode)
    private readonly agencyRepository: Repository<AgencyNode>,
  ) {}

  async preCheckImport(
    agentId: string,
    linkCode: string,
  ): Promise<PreCheckImportResult> {
    const resolveResult = await this.resolveImportCode(linkCode);
    if (!resolveResult) {
      throw new BadRequestException('无效的链接代码');
    }

    const { parentNodeId, serviceId } = resolveResult;

    if (!parentNodeId) {
      // 根节点导入
      return { action_type: 'NORMAL', service_id: serviceId };
    }

    // 检查祖先链路
    let currentParentId: string | null = parentNodeId;
    let depth = 0;
    let selfInUpstream = false;

    while (currentParentId) {
      depth++;
      if (depth >= MAX_IMPORT_DEPTH) {
        return {
          action_type: 'DEPTH_BLOCKED',
          prompt_msg: '代理层级过多无法导入',
          parent_id: parentNodeId,
          service_id: serviceId,
        };
      }

      const node = await this.agencyRepository.findOne({
        where: { id: currentParentId },
        select: ['id', 'agent_id', 'parent_node_id'],
      });

      if (!node) break;

      if (node.agent_id === agentId) {
        selfInUpstream = true;
        break;
      }

      currentParentId = node.parent_node_id;
    }

    if (selfInUpstream) {
      return {
        action_type: 'SELF_IN_UPSTREAM',
        prompt_msg: '该链接的上游链路中包含您自己的节点，是否继续新建？',
        parent_id: parentNodeId,
        service_id: serviceId,
      };
    }

    // 检查当前用户在 parent_id 下是否已有节点
    const existingChild = await this.agencyRepository.findOne({
      where: {
        agent_id: agentId,
        parent_node_id: parentNodeId,
        status: Not('DELETED'),
      },
    });

    if (existingChild) {
      return {
        action_type: 'SAME_PARENT',
        prompt_msg: '您已收藏过该上游的节点，进货价一致。是否继续新建？',
        parent_id: parentNodeId,
        service_id: serviceId,
      };
    }

    return {
      action_type: 'NORMAL',
      parent_id: parentNodeId,
      service_id: serviceId,
    };
  }

  /**
   * Internal helper to resolve various import codes (Slug, Token, URL, etc.)
   * Returns standardized import info.
   */
  async resolveImportCode(code: string): Promise<{
    serviceId: string;
    parentNodeId?: string;
    defaultAlias?: string;
    defaultPublicNotes?: string;
  } | null> {
    const slug = code.trim();

    // 1. Try AgencyNode by slug (Most common for sharing)
    try {
      const node = await this.agencyRepository.findOne({
        where: { share_slug: slug },
        relations: ['service'],
      });

      if (node) {
        return {
          serviceId: node.service_id,
          parentNodeId: node.id,
          defaultAlias:
            node.alias || node.inherited_name || node.service?.title,
          defaultPublicNotes: node.public_notes || undefined,
        };
      }
    } catch (e: unknown) {
      if (e instanceof BadRequestException) {
        throw e;
      }
    }

    // 2. Try AgencyNode by UUID (Direct ID)
    if (slug.length === 36) {
      const byId = await this.agencyRepository.findOne({
        where: { id: slug },
        relations: ['service'],
      });

      if (byId) {
        return {
          serviceId: byId.service_id,
          parentNodeId: byId.id,
          defaultAlias:
            byId.alias || byId.inherited_name || byId.service?.title,
          defaultPublicNotes: byId.public_notes || undefined,
        };
      }
    }

    return null;
  }
}
