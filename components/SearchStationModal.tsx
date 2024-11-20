import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import axios from 'axios';
import LoadingPage from '../pages/LoadingPage';
import useSelectedStationStore from '../store/useSelectedStationStore';
import { useModalActions, useModalState } from '../store/useModalStore';

const { width, height } = Dimensions.get('window');

interface Station {
  id: string;
  name: string;
}

interface SearchStationModalProps {
  favoriteStations?: Station[];
  toggleFavorite?: (id: string) => void;
}

const API_BASE_URL = Platform.select({
  ios: 'http://devse.gonetis.com:12589',
  android: 'http://10.0.2.2:8080'
});

const SearchStationModal: React.FC<SearchStationModalProps> = ({
  favoriteStations = [],
  toggleFavorite,
}) => {
  const {modalName, isModal} = useModalState();
  const {openModal, closeModal} = useModalActions();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Station[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const searchInputRef = useRef<TextInput>(null);
  const { setSelectedStation } = useSelectedStationStore();

  // 전체 정류장 데이터 조회
  const fetchAllStations = async () => {
    try {
      setIsLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/station`);
      setSearchResults(response.data.data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch stations:', err);
      setError('정류장 정보를 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 정류장 검색
  const handleSearch = async (stationName: string) => {
    if (!stationName.trim()) {
      fetchAllStations();
      return;
    }

    try {
      setIsLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/station`, {
        params: { name: stationName },
        headers: { 'Content-Type': 'application/json' },
      });
      setSearchResults(response.data.data);
      setError(null);
    } catch (err) {
      console.error('Search failed:', err);
      setError('정류장 검색에 실패했습니다.');
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  // 초기 데이터 로드
  useEffect(() => {
    fetchAllStations();
  }, []);

  const renderStationItem = ({ item }: { item: Station }) => {
    const isFavorite = favoriteStations?.some(fs => fs.id === item.id);
    
    return (
      <TouchableOpacity
        style={styles.busStopItem}
        onPress={() => {
          setSelectedStation(item);
          closeModal('minSearchModal');
        }}
        activeOpacity={0.7}
      >
        <Text style={styles.stationName}>{item.name}</Text>
        <TouchableOpacity
          style={styles.favoriteButton}
          onPress={() => toggleFavorite?.(item.id)}
        >
          <Text style={[
            styles.favoriteIcon,
            isFavorite && styles.activeFavorite
          ]}>
            {isFavorite ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return <LoadingPage />;
  }

  return (
    <Modal
      visible={modalName === 'minSearchModal' && isModal}
      transparent
      animationType="fade"
      onRequestClose={()=> closeModal('minSearchModal')}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalContainer}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={()=>openModal('minSearchModal')}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.title}>정류장 검색</Text>
            
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder="검색할 정류장 이름 입력"
              value={searchTerm}
              onChangeText={(text) => {
                setSearchTerm(text);
                handleSearch(text);
              }}
              returnKeyType="search"
              autoFocus
            />

            {error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : (
              <FlatList
                data={searchResults}
                renderItem={renderStationItem}
                keyExtractor={(item) => item.id}
                style={styles.busStopList}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>
                    검색 결과가 없습니다.
                  </Text>
                }
              />
            )}

            <TouchableOpacity
              style={styles.closeButton}
              onPress={()=>closeModal('minSearchModal')}
            >
              <Text style={styles.closeButtonText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    width: width * 0.9,
    maxWidth: 400,
    maxHeight: height * 0.8,
    borderRadius: 20,
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: {
          width: 0,
          height: 4,
        },
        shadowOpacity: 0.2,
        shadowRadius: 10,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
    color: '#333333',
  },
  searchInput: {
    width: '100%',
    padding: 10,
    marginBottom: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDDDDD',
    fontSize: 16,
  },
  busStopList: {
    maxHeight: height * 0.5,
  },
  busStopItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#DDDDDD',
  },
  stationName: {
    fontSize: 16,
    color: '#333333',
    flex: 1,
  },
  favoriteButton: {
    padding: 8,
  },
  favoriteIcon: {
    fontSize: 24,
    color: '#CCCCCC',
  },
  activeFavorite: {
    color: '#FFCC00',
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    right: 15,
    padding: 8,
  },
  closeButtonText: {
    fontSize: 18,
    color: '#333333',
  },
  emptyText: {
    textAlign: 'center',
    padding: 20,
    color: '#666666',
  },
  errorText: {
    color: '#FF3B30',
    textAlign: 'center',
    padding: 20,
  },
});

export default SearchStationModal;