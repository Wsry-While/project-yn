import type { QimingConstruction } from './types';

export type QimingConstructionRow = {
  id: string;
  external_source: string;
  external_id: string | null;
  external_op: string | null;
  external_serial: string | null;
  external_operator: string | null;

  sales_manager: string | null;
  sales_manager_id: string | null;
  project_year: string | null;
  project_name: string | null;
  is_sign_contract: boolean | null;
  school: string | null;
  school_id: string | null;
  college: string | null;
  college_id: string | null;
  school_level: string | null;
  school_level_norm: string | null;
  build_major: string | null;
  build_major_norm: string | null;
  build_content_html: string | null;
  build_content_text: string | null;
  build_special_desc_html: string | null;
  build_special_desc_text: string | null;
  project_materials: unknown;
  project_delivery_time: string | null;
  project_manager: string | null;
  project_manager_id: string | null;
  project_status_feedback: string | null;

  raw_payload: unknown;
  raw_meta: unknown;
  synced_at: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapFileArray(value: unknown): QimingConstruction['projectMaterials'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      name: typeof x.name === 'string' ? x.name : null,
      url: typeof x.url === 'string' ? x.url : null,
      objectId: typeof x.objectId === 'string' ? x.objectId : null,
      resid: typeof x.resid === 'string' ? x.resid : null,
      suffix: typeof x.suffix === 'string' ? x.suffix : null,
      size: typeof x.size === 'string' ? x.size : null,
      byteSize: typeof x.byteSize === 'number' ? x.byteSize : null,
      type: typeof x.type === 'string' ? x.type : null,
      assetId: typeof x.assetId === 'string' ? x.assetId : null,
      bucket: typeof x.bucket === 'string' ? x.bucket : null,
      storageKey: typeof x.storageKey === 'string' ? x.storageKey : null,
      storageStatus: (['pending', 'fetching', 'stored', 'failed'].includes(String(x.storageStatus))
        ? x.storageStatus
        : null) as QimingConstruction['projectMaterials'][number]['storageStatus'],
      storedAt: typeof x.storedAt === 'string' ? x.storedAt : null,
      storageError: typeof x.storageError === 'string' ? x.storageError : null,
    }));
}

export function mapQimingConstruction(row: QimingConstructionRow): QimingConstruction {
  return {
    id: row.id,
    externalSource: row.external_source,
    externalId: row.external_id,
    externalOp: row.external_op,
    externalSerial: row.external_serial,
    externalOperator: row.external_operator,

    salesManager: row.sales_manager,
    salesManagerId: row.sales_manager_id,
    projectYear: row.project_year,
    projectName: row.project_name,
    isSignContract: row.is_sign_contract,
    school: row.school,
    schoolId: row.school_id,
    college: row.college,
    collegeId: row.college_id,
    schoolLevel: row.school_level,
    schoolLevelNorm: row.school_level_norm,
    buildMajor: row.build_major,
    buildMajorNorm: row.build_major_norm,
    buildContentHtml: row.build_content_html,
    buildContentText: row.build_content_text,
    buildSpecialDescHtml: row.build_special_desc_html,
    buildSpecialDescText: row.build_special_desc_text,
    projectMaterials: mapFileArray(row.project_materials),
    projectDeliveryTime: row.project_delivery_time,
    projectManager: row.project_manager,
    projectManagerId: row.project_manager_id,
    projectStatusFeedback: row.project_status_feedback,

    rawPayload: (row.raw_payload ?? null) as Record<string, unknown> | null,
    rawMeta: (row.raw_meta ?? null) as Record<string, unknown> | null,
    syncedAt: row.synced_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
