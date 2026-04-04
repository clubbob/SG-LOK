export interface CodeMaterialMaster {
  material_code: string;
  material_name: string;
  description?: string;
  is_active: boolean;
}

export interface CodeFamilyMaster {
  category: string;
  family_code: string;
  family_name: string;
  description?: string;
  is_active: boolean;
}

export interface CodeSizeMaster {
  size_code: string;
  size_name: string;
  unit?: string;
  sort_order?: number;
  is_active: boolean;
}

export interface CodeOptionMaster {
  option_code: string;
  option_name: string;
  category?: string;
  description?: string;
  is_active: boolean;
}

export interface TubeFittingMasterMaps {
  materials: Map<string, string>;
  families: Map<string, string>;
  sizes: Map<string, string>;
  options: Map<string, string>;
}
