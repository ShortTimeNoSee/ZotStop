import importlib.util
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location('compile_gtfs', Path(__file__).with_name('compile-gtfs.py'))
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


class TimingSegmentTests(unittest.TestCase):
    def test_uses_the_most_common_runtime_between_timed_stops(self):
        trips = [{'trip_id': 'one'}, {'trip_id': 'two'}, {'trip_id': 'three'}]
        times = {
            'one': self.stop_times(0, 180),
            'two': self.stop_times(600, 780),
            'three': self.stop_times(1200, 1500),
        }

        self.assertEqual(compiler.compile_timing_segments(trips, times), [{
            'fromStopId': 'A',
            'toStopId': 'B',
            'scheduledSeconds': 180,
        }])

    @staticmethod
    def stop_times(start, end):
        return [
            {'stop_id': 'A', 'stop_sequence': '1', 'arrival_time': '', 'departure_time': f'{start // 3600:02}:{start // 60 % 60:02}:00'},
            {'stop_id': 'middle', 'stop_sequence': '2', 'arrival_time': '', 'departure_time': ''},
            {'stop_id': 'B', 'stop_sequence': '3', 'arrival_time': f'{end // 3600:02}:{end // 60 % 60:02}:00', 'departure_time': ''},
        ]


class TimepointTests(unittest.TestCase):
    def test_marks_a_stop_only_when_a_kept_trip_says_it_is_a_timepoint(self):
        rows = [
            {'trip_id': 't', 'stop_id': 'A', 'stop_sequence': '1', 'arrival_time': '08:00:00', 'departure_time': '08:00:00', 'timepoint': '1'},
            {'trip_id': 't', 'stop_id': 'B', 'stop_sequence': '2', 'arrival_time': '08:05:00', 'departure_time': '', 'timepoint': '0'},
        ]
        flags = compiler.compile_timepoints([{'trip_id': 't'}], {'t': rows})
        stops = compiler.route_stops(rows, self.lookup(), flags)
        self.assertEqual([stop['timepoint'] for stop in stops], [True, False])

    def test_leaves_a_stop_untimed_when_kept_trips_disagree(self):
        hold = [{'stop_id': 'A', 'stop_sequence': '1', 'timepoint': '1'}]
        passing = [{'stop_id': 'A', 'stop_sequence': '1', 'timepoint': '0'}]
        flags = compiler.compile_timepoints(
            [{'trip_id': 'hold'}, {'trip_id': 'pass'}],
            {'hold': hold, 'pass': passing},
        )
        self.assertEqual(flags, set())

    def test_omits_the_flag_when_the_timepoint_column_is_absent(self):
        rows = [
            {'trip_id': 't', 'stop_id': 'A', 'stop_sequence': '1', 'arrival_time': '08:00:00', 'departure_time': '08:00:00'},
            {'trip_id': 't', 'stop_id': 'B', 'stop_sequence': '2', 'arrival_time': '', 'departure_time': '08:05:00'},
        ]
        flags = compiler.compile_timepoints([{'trip_id': 't'}], {'t': rows})
        self.assertIsNone(flags)
        stops = compiler.route_stops(rows, self.lookup(), flags)
        self.assertTrue(all('timepoint' not in stop for stop in stops))

    @staticmethod
    def lookup():
        return {
            'A': {'stop_code': '1', 'stop_name': 'Hold', 'stop_lat': '33.6', 'stop_lon': '-117.8'},
            'B': {'stop_code': '2', 'stop_name': 'Pass', 'stop_lat': '33.7', 'stop_lon': '-117.8'},
        }


if __name__ == '__main__':
    unittest.main()
