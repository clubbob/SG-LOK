import { ProductionRequest } from '@/types';
import { getProductionRequestProductRows } from '@/lib/production/productionRequestDisplay';

type ProductionRequestProductLinesProps = {
  request: Pick<ProductionRequest, 'productName' | 'productCode' | 'products'>;
  field: 'name' | 'code';
  nameClassName?: string;
  codeClassName?: string;
};

export function ProductionRequestProductLines({
  request,
  field,
  nameClassName = 'text-sm font-medium text-gray-900',
  codeClassName = 'text-sm text-gray-900',
}: ProductionRequestProductLinesProps) {
  const rows = getProductionRequestProductRows(request);
  const className = field === 'name' ? nameClassName : codeClassName;

  return (
    <div className="space-y-0.5">
      {rows.map((row, index) => (
        <div key={index} className={className}>
          {field === 'name' ? row.productName : row.productCode}
        </div>
      ))}
    </div>
  );
}
