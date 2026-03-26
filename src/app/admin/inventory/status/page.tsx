"use client";

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc, Timestamp } from 'firebase/firestore';

type InboundHistory = {
  id: string;
  quantity: number;
  createdAt: string;
  variantCode?: string;
};

type OutboundHistory = {
  id: string;
  quantity: number;
  createdAt: string;
  variantCode?: string;
};

type AdjustmentHistory = {
  id: string;
  createdAt: string;
  variantCode: string;
  beforeStock: number;
  afterStock: number;
  delta: number;
  reason: string;
};

type InventoryVariant = {
  code: string;
  currentStock: number;
  unit: string;
};

type InventoryItem = {
  code: string;
  variants?: InventoryVariant[];
  currentStock: number;
  safetyStock: number;
  unit: string;
  inboundHistory: InboundHistory[];
  outboundHistory: OutboundHistory[];
  adjustmentHistory: AdjustmentHistory[];
};

type InventoryProduct = {
  name: string;
  imageSrc: string;
  items: InventoryItem[];
};

type InboundModalState = {
  isOpen: boolean;
  productName: string;
  itemCode: string;
  variantCode: string;
  mode: 'create' | 'edit';
  historyId: string | null;
  quantityInput: string;
};

type OutboundModalState = {
  isOpen: boolean;
  productName: string;
  itemCode: string;
  variantCode: string;
  mode: 'create' | 'edit';
  historyId: string | null;
  quantityInput: string;
};

type HistoryModalState = {
  isOpen: boolean;
  productName: string;
  itemCode: string;
  page: number;
};

type AdjustmentModalState = {
  isOpen: boolean;
  productName: string;
  itemCode: string;
  variantCode: string;
  actualStockInput: string;
  reasonInput: string;
};

const INITIAL_MICRO_WELD_PRODUCTS: InventoryProduct[] = [
  {
    name: 'Micro Elbow (HME)',
    imageSrc: '/inventory/micro-elbow-hme.png',
    items: [
      {
        code: 'HME-02',
        variants: [
          { code: 'HME-02-SL-BA', currentStock: 22, unit: 'EA' },
          { code: 'HME-02-SL-EP', currentStock: 18, unit: 'EA' },
          { code: 'HME-02-SM-BA', currentStock: 24, unit: 'EA' },
          { code: 'HME-02-SM-EP', currentStock: 20, unit: 'EA' },
          { code: 'HME-02-DM-BA', currentStock: 26, unit: 'EA' },
          { code: 'HME-02-DM-EP', currentStock: 18, unit: 'EA' },
        ],
        currentStock: 128,
        safetyStock: 80,
        unit: 'EA',
        inboundHistory: [],
        outboundHistory: [],
        adjustmentHistory: [],
      },
      {
        code: 'HME-04',
        variants: [
          { code: 'HME-04-SL-BA', currentStock: 9, unit: 'EA' },
          { code: 'HME-04-SL-EP', currentStock: 8, unit: 'EA' },
          { code: 'HME-04-SM-BA', currentStock: 10, unit: 'EA' },
          { code: 'HME-04-SM-EP', currentStock: 8, unit: 'EA' },
          { code: 'HME-04-DM-BA', currentStock: 11, unit: 'EA' },
          { code: 'HME-04-DM-EP', currentStock: 8, unit: 'EA' },
        ],
        currentStock: 54,
        safetyStock: 60,
        unit: 'EA',
        inboundHistory: [],
        outboundHistory: [],
        adjustmentHistory: [],
      },
      {
        code: 'HME-06',
        variants: [
          { code: 'HME-06-SL-BA', currentStock: 5, unit: 'EA' },
          { code: 'HME-06-SL-EP', currentStock: 5, unit: 'EA' },
          { code: 'HME-06-SM-BA', currentStock: 6, unit: 'EA' },
          { code: 'HME-06-SM-EP', currentStock: 5, unit: 'EA' },
          { code: 'HME-06-DM-BA', currentStock: 5, unit: 'EA' },
          { code: 'HME-06-DM-EP', currentStock: 5, unit: 'EA' },
        ],
        currentStock: 31,
        safetyStock: 60,
        unit: 'EA',
        inboundHistory: [],
        outboundHistory: [],
        adjustmentHistory: [],
      },
      {
        code: 'HME-08',
        variants: [
          { code: 'HME-08-SL-BA', currentStock: 16, unit: 'EA' },
          { code: 'HME-08-SL-EP', currentStock: 14, unit: 'EA' },
          { code: 'HME-08-SM-BA', currentStock: 17, unit: 'EA' },
          { code: 'HME-08-SM-EP', currentStock: 14, unit: 'EA' },
          { code: 'HME-08-DM-BA', currentStock: 17, unit: 'EA' },
          { code: 'HME-08-DM-EP', currentStock: 14, unit: 'EA' },
        ],
        currentStock: 92,
        safetyStock: 70,
        unit: 'EA',
        inboundHistory: [],
        outboundHistory: [],
        adjustmentHistory: [],
      },
      {
        code: 'HME-12',
        variants: [
          { code: 'HME-12-SL-BA', currentStock: 8, unit: 'EA' },
          { code: 'HME-12-SL-EP', currentStock: 7, unit: 'EA' },
          { code: 'HME-12-SM-BA', currentStock: 8, unit: 'EA' },
          { code: 'HME-12-SM-EP', currentStock: 8, unit: 'EA' },
          { code: 'HME-12-DM-BA', currentStock: 8, unit: 'EA' },
          { code: 'HME-12-DM-EP', currentStock: 8, unit: 'EA' },
        ],
        currentStock: 47,
        safetyStock: 45,
        unit: 'EA',
        inboundHistory: [],
        outboundHistory: [],
        adjustmentHistory: [],
      },
    ],
  },
];

export default function AdminInventoryStatusPage() {
  const HISTORY_PAGE_SIZE = 20;
  const HISTORY_KEEP_LIMIT = 100;
  const categories = [
    'Micro Weld Fittings',
    'Tube Butt Weld Fittings',
    'Metal Face Seal Fittings',
  ];
  const [activeCategory, setActiveCategory] = useState(categories[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [microWeldProducts, setMicroWeldProducts] = useState<InventoryProduct[]>(INITIAL_MICRO_WELD_PRODUCTS);
  const [inboundModal, setInboundModal] = useState<InboundModalState>({
    isOpen: false,
    productName: '',
    itemCode: '',
    variantCode: '',
    mode: 'create',
    historyId: null,
    quantityInput: '',
  });
  const [formError, setFormError] = useState('');
  const [outboundModal, setOutboundModal] = useState<OutboundModalState>({
    isOpen: false,
    productName: '',
    itemCode: '',
    variantCode: '',
    mode: 'create',
    historyId: null,
    quantityInput: '',
  });
  const [outboundFormError, setOutboundFormError] = useState('');
  const [historyModal, setHistoryModal] = useState<HistoryModalState>({
    isOpen: false,
    productName: '',
    itemCode: '',
    page: 1,
  });
  const [adjustmentModal, setAdjustmentModal] = useState<AdjustmentModalState>({
    isOpen: false,
    productName: '',
    itemCode: '',
    variantCode: '',
    actualStockInput: '',
    reasonInput: '',
  });
  const [adjustmentFormError, setAdjustmentFormError] = useState('');
  const [syncError, setSyncError] = useState('');

  useEffect(() => {
    const inventoryRef = doc(db, 'inventory', 'microWeldProducts');
    const unsubscribe = onSnapshot(
      inventoryRef,
      async (snapshot) => {
        if (!snapshot.exists()) {
          try {
            await setDoc(inventoryRef, {
              products: INITIAL_MICRO_WELD_PRODUCTS,
              updatedAt: Timestamp.now(),
            });
          } catch (error) {
            console.error('재고 초기 데이터 저장 오류:', error);
            setSyncError('재고 초기 데이터 저장에 실패했습니다.');
          }
          return;
        }

        const data = snapshot.data() as { products?: InventoryProduct[] } | undefined;
        if (data?.products && Array.isArray(data.products)) {
          setMicroWeldProducts(data.products);
        }
      },
      (error) => {
        console.error('재고 데이터 동기화 오류:', error);
        setSyncError('재고 데이터 동기화에 실패했습니다.');
      }
    );

    return () => unsubscribe();
  }, []);

  const persistInventoryProducts = async (nextProducts: InventoryProduct[]) => {
    try {
      await setDoc(
        doc(db, 'inventory', 'microWeldProducts'),
        {
          products: nextProducts,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      setSyncError('');
    } catch (error) {
      console.error('재고 데이터 저장 오류:', error);
      setSyncError('재고 데이터 저장에 실패했습니다.');
    }
  };

  const closeInboundModal = () => {
    setInboundModal({
      isOpen: false,
      productName: '',
      itemCode: '',
      variantCode: '',
      mode: 'create',
      historyId: null,
      quantityInput: '',
    });
    setFormError('');
  };

  const closeOutboundModal = () => {
    setOutboundModal({
      isOpen: false,
      productName: '',
      itemCode: '',
      variantCode: '',
      mode: 'create',
      historyId: null,
      quantityInput: '',
    });
    setOutboundFormError('');
  };

  const openHistoryModal = (productName: string, itemCode: string) => {
    setHistoryModal({
      isOpen: true,
      productName,
      itemCode,
      page: 1,
    });
  };

  const closeHistoryModal = () => {
    setHistoryModal({
      isOpen: false,
      productName: '',
      itemCode: '',
      page: 1,
    });
  };

  const openAdjustmentModal = (productName: string, itemCode: string) => {
    const targetItem = microWeldProducts
      .find((product) => product.name === productName)
      ?.items.find((item) => item.code === itemCode);
    const defaultVariant = targetItem?.variants?.[0];

    setAdjustmentModal({
      isOpen: true,
      productName,
      itemCode,
      variantCode: defaultVariant?.code ?? '',
      actualStockInput: defaultVariant ? String(defaultVariant.currentStock) : '',
      reasonInput: '',
    });
    setAdjustmentFormError('');
  };

  const closeAdjustmentModal = () => {
    setAdjustmentModal({
      isOpen: false,
      productName: '',
      itemCode: '',
      variantCode: '',
      actualStockInput: '',
      reasonInput: '',
    });
    setAdjustmentFormError('');
  };

  const openInboundCreateModal = (productName: string, itemCode: string) => {
    const targetItem = microWeldProducts
      .find((product) => product.name === productName)
      ?.items.find((item) => item.code === itemCode);

    setInboundModal({
      isOpen: true,
      productName,
      itemCode,
      variantCode: targetItem?.variants?.[0]?.code ?? '',
      mode: 'create',
      historyId: null,
      quantityInput: '',
    });
    setFormError('');
  };

  const openInboundEditModal = (productName: string, itemCode: string, history: InboundHistory) => {
    const targetItem = microWeldProducts
      .find((product) => product.name === productName)
      ?.items.find((item) => item.code === itemCode);

    setInboundModal({
      isOpen: true,
      productName,
      itemCode,
      variantCode: history.variantCode ?? targetItem?.variants?.[0]?.code ?? '',
      mode: 'edit',
      historyId: history.id,
      quantityInput: String(history.quantity),
    });
    setFormError('');
  };

  const openOutboundCreateModal = (productName: string, itemCode: string) => {
    const targetItem = microWeldProducts
      .find((product) => product.name === productName)
      ?.items.find((item) => item.code === itemCode);

    setOutboundModal({
      isOpen: true,
      productName,
      itemCode,
      variantCode: targetItem?.variants?.[0]?.code ?? '',
      mode: 'create',
      historyId: null,
      quantityInput: '',
    });
    setOutboundFormError('');
  };

  const openOutboundEditModal = (
    productName: string,
    itemCode: string,
    history: OutboundHistory
  ) => {
    const targetItem = microWeldProducts
      .find((product) => product.name === productName)
      ?.items.find((item) => item.code === itemCode);

    setOutboundModal({
      isOpen: true,
      productName,
      itemCode,
      variantCode: history.variantCode ?? targetItem?.variants?.[0]?.code ?? '',
      mode: 'edit',
      historyId: history.id,
      quantityInput: String(history.quantity),
    });
    setOutboundFormError('');
  };

  const handleSaveInbound = () => {
    const parsedQuantity = Number(inboundModal.quantityInput);
    const minInboundQuantity = inboundModal.mode === 'edit' ? 0 : 1;
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < minInboundQuantity) {
      setFormError(
        inboundModal.mode === 'edit'
          ? '입고 수량은 0 이상의 정수로 입력해 주세요.'
          : '입고 수량은 1 이상의 정수로 입력해 주세요.'
      );
      return;
    }
    const targetItem = microWeldProducts
      .find((product) => product.name === inboundModal.productName)
      ?.items.find((item) => item.code === inboundModal.itemCode);
    if (targetItem?.variants && targetItem.variants.length > 0 && !inboundModal.variantCode) {
      setFormError('세부 제품 코드를 선택해 주세요.');
      return;
    }

    const nextProducts = microWeldProducts.map((product) => {
        if (product.name !== inboundModal.productName) {
          return product;
        }

        return {
          ...product,
          items: product.items.map((item) => {
            if (item.code !== inboundModal.itemCode) {
              return item;
            }

            if (inboundModal.mode === 'create') {
              const nowIso = new Date().toISOString();
              const nextHistory: InboundHistory = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                quantity: parsedQuantity,
                createdAt: nowIso,
                variantCode: inboundModal.variantCode || undefined,
              };

              const nextVariants = item.variants
                ? item.variants.map((variant) =>
                    variant.code === inboundModal.variantCode
                      ? { ...variant, currentStock: variant.currentStock + parsedQuantity }
                      : variant
                  )
                : undefined;

              return {
                ...item,
                currentStock: nextVariants
                  ? nextVariants.reduce((sum, variant) => sum + variant.currentStock, 0)
                  : item.currentStock + parsedQuantity,
                variants: nextVariants,
                inboundHistory: [nextHistory, ...item.inboundHistory].slice(0, HISTORY_KEEP_LIMIT),
              };
            }

            if (!inboundModal.historyId) {
              return item;
            }

            const targetHistory = item.inboundHistory.find(
              (history) => history.id === inboundModal.historyId
            );
            if (!targetHistory) {
              return item;
            }

            const stockDiff = parsedQuantity - targetHistory.quantity;
            const nextVariants = item.variants
              ? item.variants.map((variant) => {
                  if (variant.code !== (targetHistory.variantCode || inboundModal.variantCode)) {
                    return variant;
                  }
                  return {
                    ...variant,
                    currentStock: variant.currentStock + stockDiff,
                  };
                })
              : undefined;

            return {
              ...item,
              currentStock: nextVariants
                ? nextVariants.reduce((sum, variant) => sum + variant.currentStock, 0)
                : item.currentStock + stockDiff,
              variants: nextVariants,
              inboundHistory: item.inboundHistory.map((history) =>
                history.id === inboundModal.historyId
                  ? { ...history, quantity: parsedQuantity, variantCode: inboundModal.variantCode || undefined }
                  : history
              ),
            };
          }),
        };
      });

    setMicroWeldProducts(nextProducts);
    void persistInventoryProducts(nextProducts);

    closeInboundModal();
  };

  const handleSaveOutbound = () => {
    const parsedQuantity = Number(outboundModal.quantityInput);
    const minOutboundQuantity = outboundModal.mode === 'edit' ? 0 : 1;
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < minOutboundQuantity) {
      setOutboundFormError(
        outboundModal.mode === 'edit'
          ? '출고 수량은 0 이상의 정수로 입력해 주세요.'
          : '출고 수량은 1 이상의 정수로 입력해 주세요.'
      );
      return;
    }

    const targetItem = microWeldProducts
      .find((product) => product.name === outboundModal.productName)
      ?.items.find((item) => item.code === outboundModal.itemCode);
    if (targetItem?.variants && targetItem.variants.length > 0 && !outboundModal.variantCode) {
      setOutboundFormError('세부 제품 코드를 선택해 주세요.');
      return;
    }

    const targetVariant = targetItem?.variants?.find(
      (variant) => variant.code === outboundModal.variantCode
    );
    if (outboundModal.mode === 'create' && targetVariant && parsedQuantity > targetVariant.currentStock) {
      setOutboundFormError('현재고보다 큰 수량은 출고할 수 없습니다.');
      return;
    }

    const nextProducts = microWeldProducts.map((product) => {
        if (product.name !== outboundModal.productName) {
          return product;
        }

        return {
          ...product,
          items: product.items.map((item) => {
            if (item.code !== outboundModal.itemCode) {
              return item;
            }

            if (outboundModal.mode === 'create') {
              const nowIso = new Date().toISOString();
              const nextHistory: OutboundHistory = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                quantity: parsedQuantity,
                createdAt: nowIso,
                variantCode: outboundModal.variantCode || undefined,
              };

              const nextVariants = item.variants
                ? item.variants.map((variant) =>
                    variant.code === outboundModal.variantCode
                      ? { ...variant, currentStock: Math.max(0, variant.currentStock - parsedQuantity) }
                      : variant
                  )
                : undefined;

              return {
                ...item,
                currentStock: nextVariants
                  ? nextVariants.reduce((sum, variant) => sum + variant.currentStock, 0)
                  : Math.max(0, item.currentStock - parsedQuantity),
                variants: nextVariants,
                outboundHistory: [nextHistory, ...item.outboundHistory].slice(0, HISTORY_KEEP_LIMIT),
              };
            }

            if (!outboundModal.historyId) {
              return item;
            }

            const targetHistory = item.outboundHistory.find(
              (history) => history.id === outboundModal.historyId
            );
            if (!targetHistory) {
              return item;
            }

            const stockDiff = parsedQuantity - targetHistory.quantity;
            const nextVariants = item.variants
              ? item.variants.map((variant) => {
                  if (variant.code !== (targetHistory.variantCode || outboundModal.variantCode)) {
                    return variant;
                  }
                  if (stockDiff > 0 && stockDiff > variant.currentStock) {
                    return variant;
                  }
                  return {
                    ...variant,
                    currentStock: Math.max(0, variant.currentStock - stockDiff),
                  };
                })
              : undefined;

            const editedVariant = nextVariants?.find(
              (variant) => variant.code === (targetHistory.variantCode || outboundModal.variantCode)
            );
            if (stockDiff > 0 && editedVariant && editedVariant.currentStock < 0) {
              return item;
            }

            return {
              ...item,
              currentStock: nextVariants
                ? nextVariants.reduce((sum, variant) => sum + variant.currentStock, 0)
                : Math.max(0, item.currentStock - stockDiff),
              variants: nextVariants,
              outboundHistory: item.outboundHistory.map((history) =>
                history.id === outboundModal.historyId
                  ? {
                      ...history,
                      quantity: parsedQuantity,
                      variantCode: outboundModal.variantCode || undefined,
                    }
                  : history
              ),
            };
          }),
        };
      });

    setMicroWeldProducts(nextProducts);
    void persistInventoryProducts(nextProducts);

    closeOutboundModal();
  };

  const handleSaveAdjustment = () => {
    const parsedActualStock = Number(adjustmentModal.actualStockInput);
    if (!Number.isInteger(parsedActualStock) || parsedActualStock < 0) {
      setAdjustmentFormError('실물 재고는 0 이상의 정수로 입력해 주세요.');
      return;
    }
    if (!adjustmentModal.reasonInput.trim()) {
      setAdjustmentFormError('조정 사유를 입력해 주세요.');
      return;
    }

    const targetVariant = microWeldProducts
      .find((product) => product.name === adjustmentModal.productName)
      ?.items.find((item) => item.code === adjustmentModal.itemCode)
      ?.variants?.find((variant) => variant.code === adjustmentModal.variantCode);
    if (!targetVariant) {
      setAdjustmentFormError('세부 제품 코드를 선택해 주세요.');
      return;
    }

    const delta = parsedActualStock - targetVariant.currentStock;
    if (delta === 0) {
      setAdjustmentFormError('변경된 재고가 없습니다. 다른 수량을 입력해 주세요.');
      return;
    }

    const nextProducts = microWeldProducts.map((product) => {
        if (product.name !== adjustmentModal.productName) {
          return product;
        }

        return {
          ...product,
          items: product.items.map((item) => {
            if (item.code !== adjustmentModal.itemCode) {
              return item;
            }

            const nextVariants = item.variants
              ? item.variants.map((variant) =>
                  variant.code === adjustmentModal.variantCode
                    ? { ...variant, currentStock: parsedActualStock }
                    : variant
                )
              : undefined;

            const nextHistory: AdjustmentHistory = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              createdAt: new Date().toISOString(),
              variantCode: adjustmentModal.variantCode,
              beforeStock: targetVariant.currentStock,
              afterStock: parsedActualStock,
              delta,
              reason: adjustmentModal.reasonInput.trim(),
            };

            return {
              ...item,
              currentStock: nextVariants
                ? nextVariants.reduce((sum, variant) => sum + variant.currentStock, 0)
                : parsedActualStock,
              variants: nextVariants,
              adjustmentHistory: [nextHistory, ...item.adjustmentHistory].slice(0, HISTORY_KEEP_LIMIT),
            };
          }),
        };
      });

    setMicroWeldProducts(nextProducts);
    void persistInventoryProducts(nextProducts);

    closeAdjustmentModal();
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const modalTargetItem = microWeldProducts
    .find((product) => product.name === inboundModal.productName)
    ?.items.find((item) => item.code === inboundModal.itemCode);
  const outboundModalTargetItem = microWeldProducts
    .find((product) => product.name === outboundModal.productName)
    ?.items.find((item) => item.code === outboundModal.itemCode);
  const adjustmentModalTargetItem = microWeldProducts
    .find((product) => product.name === adjustmentModal.productName)
    ?.items.find((item) => item.code === adjustmentModal.itemCode);
  const historyTargetItem = microWeldProducts
    .find((product) => product.name === historyModal.productName)
    ?.items.find((item) => item.code === historyModal.itemCode);
  const combinedHistoryRows = historyTargetItem
    ? [
        ...historyTargetItem.inboundHistory.map((history) => ({
          kind: 'inbound' as const,
          id: history.id,
          createdAt: history.createdAt,
          quantity: history.quantity,
          variantCode: history.variantCode,
          raw: history,
        })),
        ...historyTargetItem.outboundHistory.map((history) => ({
          kind: 'outbound' as const,
          id: history.id,
          createdAt: history.createdAt,
          quantity: history.quantity,
          variantCode: history.variantCode,
          raw: history,
        })),
        ...historyTargetItem.adjustmentHistory.map((history) => ({
          kind: 'adjustment' as const,
          id: history.id,
          createdAt: history.createdAt,
          quantity: history.delta,
          variantCode: history.variantCode,
          raw: history,
        })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];
  const historyTotalPages = Math.max(1, Math.ceil(combinedHistoryRows.length / HISTORY_PAGE_SIZE));
  const historyCurrentPage = Math.min(historyModal.page, historyTotalPages);
  const pagedHistoryRows = combinedHistoryRows.slice(
    (historyCurrentPage - 1) * HISTORY_PAGE_SIZE,
    historyCurrentPage * HISTORY_PAGE_SIZE
  );
  const filteredMicroWeldProducts = microWeldProducts
    .map((product) => {
      const isProductNameMatched = product.name.toLowerCase().includes(normalizedQuery);
      const filteredItems =
        normalizedQuery === '' || isProductNameMatched
          ? product.items
          : product.items.filter(
              (item) =>
                item.code.toLowerCase().includes(normalizedQuery) ||
                item.variants?.some((variant) =>
                  variant.code.toLowerCase().includes(normalizedQuery)
                )
            );

      return {
        ...product,
        filteredItems,
      };
    })
    .filter((product) => product.filteredItems.length > 0);

  return (
    <div className="p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">UHP 재고현황</h1>
        <p className="text-gray-600 mt-2">현재 UHP 재고 현황을 관리하는 페이지입니다.</p>
        {syncError && (
          <p className="mt-2 text-sm font-medium text-red-600">{syncError}</p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="mb-4">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
              </svg>
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="제품명 검색..."
              className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        <h2 className="text-lg font-semibold text-gray-900 mb-4">제품 카테고리</h2>
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={`rounded-md border px-4 py-2.5 text-base font-semibold transition-colors ${
                activeCategory === category
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
        {activeCategory === 'Micro Weld Fittings' && (
          <div className="mt-6 space-y-4">
            {filteredMicroWeldProducts.map((product) => (
              <div key={product.name} className="rounded-lg border border-gray-200 bg-white p-5">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{product.name}</h3>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                    <div className="h-[180px] w-full overflow-hidden rounded-md border border-gray-200 bg-white">
                      <img
                        src={product.imageSrc}
                        alt={product.name}
                        className="h-full w-full object-contain"
                      />
                    </div>
                  </div>

                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {product.filteredItems.map((item) => (
                        <div
                          key={item.code}
                          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-800">{item.code}</p>
                            <span
                              className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700"
                            >
                              총 현재고{' '}
                              {item.variants && item.variants.length > 0
                                ? item.variants.reduce(
                                    (sum, variant) => sum + variant.currentStock,
                                    0
                                  )
                                : item.currentStock}{' '}
                              {item.unit}
                            </span>
                          </div>
                          {item.variants && item.variants.length > 0 && (
                            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                              {item.variants.map((variant) => (
                                <div
                                  key={variant.code}
                                  className="flex items-center justify-between gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-[11px]"
                                >
                                  <span className="font-medium text-gray-700">{variant.code}</span>
                                  <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700">
                                    {variant.currentStock} {variant.unit}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => openInboundCreateModal(product.name, item.code)}
                              className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                            >
                              입고
                            </button>
                            <button
                              type="button"
                              onClick={() => openOutboundCreateModal(product.name, item.code)}
                              className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                            >
                              출고
                            </button>
                            <button
                              type="button"
                              className="rounded border border-purple-200 bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100"
                            >
                              생산계획
                            </button>
                            <button
                              type="button"
                              onClick={() => openAdjustmentModal(product.name, item.code)}
                              className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                            >
                              재고조정
                            </button>
                            <button
                              type="button"
                              onClick={() => openHistoryModal(product.name, item.code)}
                              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                            >
                              이력수정
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {filteredMicroWeldProducts.length === 0 && (
              <p className="rounded-md border border-dashed border-gray-300 bg-white px-3 py-4 text-sm text-gray-500">
                검색 결과가 없습니다.
              </p>
            )}
          </div>
        )}
      </div>

      {inboundModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {inboundModal.mode === 'create' ? '입고 등록' : '입고 수량 수정'}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {inboundModal.productName} / {inboundModal.itemCode}
              </p>
            </div>
            <div className="px-5 py-4">
              {modalTargetItem?.variants && modalTargetItem.variants.length > 0 && (
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="inboundVariantCode">
                    세부 제품 코드
                  </label>
                  <select
                    id="inboundVariantCode"
                    value={inboundModal.variantCode}
                    onChange={(e) =>
                      setInboundModal((prev) => ({
                        ...prev,
                        variantCode: e.target.value,
                      }))
                    }
                    disabled={inboundModal.mode === 'edit'}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    {modalTargetItem.variants.map((variant) => (
                      <option key={variant.code} value={variant.code}>
                        {variant.code}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="inboundQuantity">
                입고 수량
              </label>
              <input
                id="inboundQuantity"
                type="number"
                min={inboundModal.mode === 'edit' ? 0 : 1}
                step={1}
                value={inboundModal.quantityInput}
                onChange={(e) =>
                  setInboundModal((prev) => ({
                    ...prev,
                    quantityInput: e.target.value,
                  }))
                }
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="수량을 입력하세요"
              />
              {formError && <p className="mt-2 text-sm text-red-600">{formError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={closeInboundModal}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveInbound}
                className="rounded-md border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {outboundModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {outboundModal.mode === 'create' ? '출고 등록' : '출고 수량 수정'}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {outboundModal.productName} / {outboundModal.itemCode}
              </p>
            </div>
            <div className="px-5 py-4">
              {outboundModalTargetItem?.variants && outboundModalTargetItem.variants.length > 0 && (
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="outboundVariantCode">
                    세부 제품 코드
                  </label>
                  <select
                    id="outboundVariantCode"
                    value={outboundModal.variantCode}
                    onChange={(e) =>
                      setOutboundModal((prev) => ({
                        ...prev,
                        variantCode: e.target.value,
                      }))
                    }
                    disabled={outboundModal.mode === 'edit'}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100 disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    {outboundModalTargetItem.variants.map((variant) => (
                      <option key={variant.code} value={variant.code}>
                        {variant.code}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="outboundQuantity">
                출고 수량
              </label>
              <input
                id="outboundQuantity"
                type="number"
                min={outboundModal.mode === 'edit' ? 0 : 1}
                step={1}
                value={outboundModal.quantityInput}
                onChange={(e) =>
                  setOutboundModal((prev) => ({
                    ...prev,
                    quantityInput: e.target.value,
                  }))
                }
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100"
                placeholder="수량을 입력하세요"
              />
              {outboundFormError && <p className="mt-2 text-sm text-red-600">{outboundFormError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={closeOutboundModal}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveOutbound}
                className="rounded-md border border-red-600 bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {adjustmentModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">재고조정</h3>
              <p className="mt-1 text-sm text-gray-600">
                {adjustmentModal.productName} / {adjustmentModal.itemCode}
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              {adjustmentModalTargetItem?.variants && adjustmentModalTargetItem.variants.length > 0 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="adjustmentVariantCode">
                    세부 제품 코드
                  </label>
                  <select
                    id="adjustmentVariantCode"
                    value={adjustmentModal.variantCode}
                    onChange={(e) =>
                      setAdjustmentModal((prev) => {
                        const selectedVariant = adjustmentModalTargetItem.variants?.find(
                          (variant) => variant.code === e.target.value
                        );
                        return {
                          ...prev,
                          variantCode: e.target.value,
                          actualStockInput: selectedVariant
                            ? String(selectedVariant.currentStock)
                            : prev.actualStockInput,
                        };
                      })
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
                  >
                    {adjustmentModalTargetItem.variants.map((variant) => (
                      <option key={variant.code} value={variant.code}>
                        {variant.code} (현재 {variant.currentStock} {variant.unit})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="adjustmentActualStock">
                  실물 재고
                </label>
                <input
                  id="adjustmentActualStock"
                  type="number"
                  min={0}
                  step={1}
                  value={adjustmentModal.actualStockInput}
                  onChange={(e) =>
                    setAdjustmentModal((prev) => ({
                      ...prev,
                      actualStockInput: e.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
                  placeholder="실물 재고를 입력하세요"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700" htmlFor="adjustmentReason">
                  조정 사유
                </label>
                <input
                  id="adjustmentReason"
                  type="text"
                  value={adjustmentModal.reasonInput}
                  onChange={(e) =>
                    setAdjustmentModal((prev) => ({
                      ...prev,
                      reasonInput: e.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100"
                  placeholder="예: 실사 차이 보정"
                />
              </div>
              {adjustmentFormError && (
                <p className="text-sm text-red-600">{adjustmentFormError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={closeAdjustmentModal}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveAdjustment}
                className="rounded-md border border-amber-600 bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {historyModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-4xl rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">입출고 이력수정</h3>
              <p className="mt-1 text-sm text-gray-600">
                {historyModal.productName} / {historyModal.itemCode}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                과거 입고/출고 등록 내역을 선택해 수량을 수정할 수 있습니다.
              </p>
            </div>
            <div className="px-5 py-4">
              {pagedHistoryRows.length === 0 ? (
                <p className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                  등록된 이력이 없습니다.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 text-gray-700">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">일시</th>
                        <th className="px-3 py-2 text-left font-semibold">구분</th>
                        <th className="px-3 py-2 text-left font-semibold">세부코드</th>
                        <th className="px-3 py-2 text-right font-semibold">수량</th>
                        <th className="px-3 py-2 text-center font-semibold">관리</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {pagedHistoryRows.map((row) => (
                        <tr key={`${row.kind}-${row.id}`}>
                          <td className="px-3 py-2 text-gray-700">
                            {new Date(row.createdAt).toLocaleString('ko-KR')}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                                row.kind === 'inbound'
                                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                                  : row.kind === 'outbound'
                                    ? 'border-red-200 bg-red-50 text-red-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-700'
                              }`}
                            >
                              {row.kind === 'inbound' ? '입고' : row.kind === 'outbound' ? '출고' : '조정'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-700">{row.variantCode || '-'}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-800">
                            {row.kind === 'adjustment' && row.quantity > 0 ? `+${row.quantity}` : row.quantity}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {row.kind === 'adjustment' ? (
                              <span className="text-xs text-gray-400">-</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  if (row.kind === 'inbound') {
                                    openInboundEditModal(
                                      historyModal.productName,
                                      historyModal.itemCode,
                                      row.raw
                                    );
                                  } else {
                                    openOutboundEditModal(
                                      historyModal.productName,
                                      historyModal.itemCode,
                                      row.raw
                                    );
                                  }
                                  closeHistoryModal();
                                }}
                                className="rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                              >
                                수정
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-4">
              <div className="text-sm text-gray-600">
                총 {combinedHistoryRows.length}건 / {historyCurrentPage} / {historyTotalPages} 페이지
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setHistoryModal((prev) => ({
                      ...prev,
                      page: Math.max(1, prev.page - 1),
                    }))
                  }
                  disabled={historyCurrentPage <= 1}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  이전
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setHistoryModal((prev) => ({
                      ...prev,
                      page: Math.min(historyTotalPages, prev.page + 1),
                    }))
                  }
                  disabled={historyCurrentPage >= historyTotalPages}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  다음
                </button>
                <button
                  type="button"
                  onClick={closeHistoryModal}
                  className="ml-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

