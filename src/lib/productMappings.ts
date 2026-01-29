import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy,
  Timestamp 
} from 'firebase/firestore';
import { db } from './firebase';
import { ProductMapping } from '@/types';

const COLLECTION_NAME = 'productMappings';

/**
 * 제품명코드로 매핑 조회
 */
export const getProductMappingByCode = async (productCode: string): Promise<ProductMapping | null> => {
  try {
    const q = query(
      collection(db, COLLECTION_NAME),
      where('productCode', '==', productCode.toUpperCase())
    );
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      return null;
    }
    
    const doc = querySnapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      productCode: data.productCode,
      productName: data.productName,
      createdAt: data.createdAt?.toDate(),
      updatedAt: data.updatedAt?.toDate(),
      createdBy: data.createdBy,
      updatedBy: data.updatedBy,
    };
  } catch (error) {
    console.error('제품명코드 매핑 조회 오류:', error);
    throw error;
  }
};

/**
 * 모든 매핑 목록 조회
 */
export const getAllProductMappings = async (): Promise<ProductMapping[]> => {
  try {
    const q = query(
      collection(db, COLLECTION_NAME),
      orderBy('productCode', 'asc')
    );
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        productCode: data.productCode,
        productName: data.productName,
        createdAt: data.createdAt?.toDate(),
        updatedAt: data.updatedAt?.toDate(),
        createdBy: data.createdBy,
        updatedBy: data.updatedBy,
      };
    });
  } catch (error) {
    console.error('제품명코드 매핑 목록 조회 오류:', error);
    throw error;
  }
};

/**
 * 매핑 추가
 */
export const addProductMapping = async (
  productCode: string,
  productName: string,
  userId?: string
): Promise<string> => {
  try {
    // 중복 확인
    const existing = await getProductMappingByCode(productCode);
    if (existing) {
      throw new Error(`제품명코드 "${productCode}"는 이미 등록되어 있습니다.`);
    }
    
    const newMapping = {
      productCode: productCode.toUpperCase(),
      productName: productName,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: userId || 'system',
      updatedBy: userId || 'system',
    };
    
    const docRef = await addDoc(collection(db, COLLECTION_NAME), newMapping);
    return docRef.id;
  } catch (error) {
    console.error('제품명코드 매핑 추가 오류:', error);
    throw error;
  }
};

/**
 * 매핑 수정
 */
export const updateProductMapping = async (
  id: string,
  productName: string,
  userId?: string
): Promise<void> => {
  try {
    const docRef = doc(db, COLLECTION_NAME, id);
    await updateDoc(docRef, {
      productName: productName,
      updatedAt: Timestamp.now(),
      updatedBy: userId || 'system',
    });
  } catch (error) {
    console.error('제품명코드 매핑 수정 오류:', error);
    throw error;
  }
};

/**
 * 매핑 삭제
 */
export const deleteProductMapping = async (id: string): Promise<void> => {
  try {
    const docRef = doc(db, COLLECTION_NAME, id);
    await deleteDoc(docRef);
  } catch (error) {
    console.error('제품명코드 매핑 삭제 오류:', error);
    throw error;
  }
};
