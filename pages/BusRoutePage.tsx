import React, {useEffect, useState, useCallback} from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import {useRoute, RouteProp, useNavigation} from '@react-navigation/native';
import {SafeAreaView} from 'react-native-safe-area-context';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import useSelectedStationStore from '../store/useSelectedStationStore';

const API_BASE_URL = Platform.select({
  ios: 'http://devse.gonetis.com:12589',
  android: 'http://10.0.2.2:8080',
});

type RootStackParamList = {
  BusRoute: {busNumber: string};
};

interface Station {
  idx?: number | undefined;
  id: string;
  name: string;
  isCurrentStation?: boolean;
  isPassed?: boolean;
  remainingTime?: number;
  location?: {
    coordinates: number[];
    type: string;
  };
}

interface BusInfo {
  id: string;
  busNumber: string;
  totalSeats: number;
  occupiedSeats: number;
  availableSeats: number;
  location: {
    coordinates: number[];
    type: string;
  };
  stationNames: string[];
  timestamp: string;
  position?: number;
  currentStationIndex?: number;
  nextStationIndex?: number;
  indicatorStyle?: {
    top: number;
  };
}

interface BusLocationInfo {
  currentIndex: number;
  nextIndex: number;
  remainingTime: number;
  position: number;
}

const BusRoutePage: React.FC = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'BusRoute'>>();
  const [stationList, setStationList] = useState<Station[]>([]);
  const [busInfo, setBusInfo] = useState<BusInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeToNextStation, setTimeToNextStation] = useState<number>(0);
  const {setSelectedStation} = useSelectedStationStore();
  const navigation = useNavigation();

  const busNumber = route.params.busNumber;

  const parseDurationToSeconds = (durationMessage: string) => {
    const matches = durationMessage.match(/(\d+)분\s*(\d+)?초?/);
    if (matches) {
      const minutes = parseInt(matches[1], 10);
      const seconds = matches[2] ? parseInt(matches[2], 10) : 0;
      return minutes * 60 + seconds;
    }
    return 0;
  };

  const calculateArrivalTime = async (
    startLocation: {x: number; y: number},
    endLocation: {x: number; y: number},
    startName: string,
    endName: string,
  ) => {
    try {
      // 거리가 매우 가까운 경우 스킵
      if (
        Math.abs(startLocation.x - endLocation.x) < 0.0001 &&
        Math.abs(startLocation.y - endLocation.y) < 0.0001
      ) {
        return {
          name: startName,
          durationMessage: '0분 0초',
        };
      }

      const token = await AsyncStorage.getItem('token');
      const response = await axios.get(
        `${API_BASE_URL}/api/kakao-api/arrival-time/single`,
        {
          params: {
            origin: `${startName},${startLocation.y},${startLocation.x}`,
            destination: `${endName},${endLocation.y},${endLocation.x}`,
            //이전까지의 경유지
            // waypoints: [
            //   {
            //     //name, y, x
            //   },
            //   {
            //     //name, y, x
            //   },
            // ]
          },
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 400) {
        // API 한도 초과시 기본값 반환
        return {
          name: startName,
          durationMessage: '5분 0초',
        };
      }
      return null;
    }
  };

  const findCurrentBusLocation = async (
    busLocationData: {coordinates: number[]},
    stations: Station[],
  ): Promise<BusLocationInfo | null> => {
    try {
      const busLocation = {
        x: busLocationData.coordinates[0],
        y: busLocationData.coordinates[1],
      };

      const timeResults: {index: number; remainingTime: number}[] = [];
      for (const station of stations) {
        if (!station.location?.coordinates) continue;

        const result = await calculateArrivalTime(
          busLocation, // 버스 위치(출발지)
          {
            x: station.location.coordinates[0],
            y: station.location.coordinates[1],
          },
          busNumber,
          station.name,
        );
        console.log('Result from calculateArrivalTime:', result);

        if (result) {
          timeResults.push({
            index: station.idx!,
            remainingTime: parseDurationToSeconds(result.durationMessage),
          });
        }
      }

      if (timeResults.length < 2) return null;

      // 남은 시간이 가장 적은 2개의 정류장 찾기
      timeResults.sort((a, b) => a.remainingTime - b.remainingTime); // 오름차순
      const closestTwo = timeResults
        .slice(0, 2)
        .sort((a, b) => a.index - b.index); // 인덱스 기준 오름차순

      const [prevStation, nextStation] = closestTwo;

      return {
        currentIndex: prevStation.index,
        nextIndex: nextStation.index,
        remainingTime: nextStation.remainingTime,
        position: calculatePosition(
          prevStation.remainingTime,
          nextStation.remainingTime,
        ),
      };
    } catch (error) {
      console.error('버스 위치 계산 실패:', error);
      return null;
    }
  };

  const calculatePosition = (prevTime: number, nextTime: number): number => {
    const totalTime = prevTime + nextTime;
    return Math.floor((prevTime * 50) / totalTime);
  };

  const fetchStationList = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `${API_BASE_URL}/api/bus/stationNames/${busNumber}`,
      );
      const stationNames = response.data.data;

      const stationsWithDetails = await Promise.all(
        stationNames.map(async (name: string, index: number) => {
          const stationDetail = await fetchStationDetail(name, index);
          return {
            ...stationDetail,
          };
        }),
      );

      setStationList(stationsWithDetails);
      setError(null);
    } catch (error) {
      console.error('정류장 목록을 불러오는 중 오류 발생:', error);
      setError('정류장 정보를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [busNumber]);

  const fetchStationDetail = async (stationName: string, index: number) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/station`, {
        params: {stationName},
      });

      // stationName에 해당하는 정류장 데이터 찾기
      const matchedStation = response.data.data.find(
        (station: {name: string}) => station.name === stationName,
      );

      if (!matchedStation) {
        console.error(`Station not found for name: ${stationName}`);
        return null;
      }

      return {
        ...matchedStation,
        idx: index,
      };
    } catch (error) {
      console.error('정류장 상세 정보 조회 실패:', error);
      return null;
    }
  };

  const fetchBusInfo = useCallback(async () => {
    try {
      const response = await axios.get<{data: BusInfo}>(
        `${API_BASE_URL}/api/bus/${busNumber}`,
      );
      const busData = response.data.data;

      if (!busData?.location || stationList.length === 0) return;

      const locationInfo = await findCurrentBusLocation(
        busData.location,
        stationList,
      );

      if (!locationInfo) return;

      const {currentIndex, nextIndex, remainingTime, position} = locationInfo;

      setTimeToNextStation(prevTime => {
        if (prevTime !== remainingTime) return remainingTime;
        return prevTime;
      });

      setStationList(prevList => {
        const updatedList = prevList.map((station, index) => ({
          ...station,
          isPassed: index <= currentIndex,
          isCurrentStation: index > currentIndex,
          remainingTime: index === nextIndex ? remainingTime : undefined,
        }));

        // 이전 값과 비교하여 변경이 있을 경우에만 상태 업데이트
        if (JSON.stringify(updatedList) !== JSON.stringify(prevList)) {
          return updatedList;
        }
        return prevList;
      });

      setBusInfo({
        ...busData,
        currentStationIndex: currentIndex,
        nextStationIndex: nextIndex,
        position,
        indicatorStyle: {
          top: position + 30,
        },
      });
    } catch (error) {
      console.error('버스 정보를 불러오는 중 오류 발생:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busNumber, stationList]);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      if (mounted) {
        await fetchStationList();
      }
    };
    init();
    return () => {
      mounted = false;
    };
  }, [fetchStationList]);

  useEffect(() => {
    let isSubscribed = true;

    const updateBusInfo = async () => {
      if (isSubscribed && stationList.length > 0) {
        await fetchBusInfo();
      }
    };

    updateBusInfo();

    return () => {
      isSubscribed = false;
    };
  }, [fetchBusInfo, stationList]);

  const handleStationClick = useCallback(
    (station: Station) => {
      const convertedStation: {
        id: string;
        name: string;
        location?: {
          x: number;
          y: number;
        };
      } = {
        id: station.id,
        name: station.name,
        location: station.location
          ? {
              x: station.location.coordinates[0],
              y: station.location.coordinates[1],
            }
          : undefined,
      };

      setSelectedStation(convertedStation);
      navigation.navigate('Home' as never);
    },
    [navigation, setSelectedStation],
  );

  const renderStationItem = useCallback(
    ({item, index}: {item: Station; index: number}) => {
      const isBusHere = busInfo && index === busInfo.currentStationIndex;
      const shouldShowBus =
        busInfo &&
        index === busInfo.currentStationIndex &&
        typeof busInfo.position === 'number';

      return (
        <TouchableOpacity onPress={() => handleStationClick(item)}>
          <View style={styles.stationItem}>
            <View style={styles.stationLineContainer}>
              <View
                style={[
                  styles.verticalLine,
                  item.isPassed && styles.passedLine,
                  isBusHere && styles.currentLine,
                  index === 0 && styles.firstLine,
                  index === stationList.length - 1 && styles.lastLine,
                ]}>
                {shouldShowBus && busInfo.indicatorStyle && (
                  <View
                    style={[
                      styles.busIndicatorContainer,
                      {top: busInfo.indicatorStyle.top},
                    ]}>
                    <View style={styles.busIndicator}>
                      <Text style={styles.busEmoji}>🚌</Text>
                    </View>
                  </View>
                )}
              </View>

              <View
                style={[
                  styles.stationDot,
                  item.isPassed && styles.passedDot,
                  isBusHere && styles.currentDot,
                ]}
              />
            </View>

            <View style={styles.stationInfoContainer}>
              <Text
                style={[
                  styles.stationName,
                  isBusHere && styles.currentStationName,
                ]}>
                {item.name}
              </Text>
              {item.remainingTime && (
                <Text style={styles.remainingTime}>
                  {Math.ceil(item.remainingTime / 60)}분 후 도착
                </Text>
              )}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busInfo],
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#F05034" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          <Text style={styles.busNumber}>{busNumber}</Text>
          {timeToNextStation > 0 && (
            <Text style={styles.headerRoute}>
              {` | ${Math.ceil(timeToNextStation / 60)}분 후 도착`}
            </Text>
          )}
        </Text>
      </View>

      <FlatList
        data={stationList}
        renderItem={renderStationItem}
        keyExtractor={(item, index) => index.toString()}
        style={styles.stationList}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  headerText: {
    fontSize: 18,
    color: '#333333',
  },
  busNumber: {
    fontWeight: 'bold',
    color: '#333333',
  },
  headerRoute: {
    fontSize: 16,
    color: '#666666',
  },
  stationList: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  stationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
  },
  stationLineContainer: {
    width: 24,
    alignItems: 'center',
    height: 50,
    position: 'relative',
  },
  verticalLine: {
    position: 'absolute',
    width: 2,
    top: 0,
    bottom: 0,
    backgroundColor: '#E5E5E5',
    left: '50%',
    marginLeft: -1,
  },
  firstLine: {
    top: '50%',
  },
  lastLine: {
    bottom: '50%',
  },
  passedLine: {
    backgroundColor: '#4CAF50',
  },
  currentLine: {
    backgroundColor: '#F05034',
  },
  stationDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E5E5E5',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginTop: 19,
    zIndex: 1,
  },
  passedDot: {
    backgroundColor: '#4CAF50',
  },
  currentDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#F05034',
    borderWidth: 3,
    marginTop: 17,
  },
  busIndicatorContainer: {
    position: 'absolute',
    left: -11,
    transform: [{translateY: -12}],
    zIndex: 2,
  },
  busIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F05034',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  busEmoji: {
    fontSize: 14,
    color: '#FFFFFF',
  },
  stationInfoContainer: {
    flex: 1,
    paddingVertical: 4,
    marginLeft: 12,
  },
  stationName: {
    fontSize: 16,
    color: '#333333',
    marginTop: 15,
  },
  currentStationName: {
    color: '#F05034',
    fontWeight: 'bold',
  },
  remainingTime: {
    fontSize: 12,
    color: '#666666',
    marginTop: 4,
  },
  errorText: {
    fontSize: 16,
    color: '#F05034',
    textAlign: 'center',
    padding: 16,
  },
});

export default BusRoutePage;
