import math
import unittest

from geometry import simplify


class SimplifyTests(unittest.TestCase):
    def test_closed_loop_keeps_area_and_closure(self):
        square = [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]
        result = simplify(square, 4)
        self.assertEqual(result[0], result[-1])
        self.assertEqual(len(result), 5)

    def test_large_line_does_not_recurse(self):
        line = [[i * 0.00001, 33.645556] for i in range(5000)]
        self.assertEqual(len(simplify(line, 4)), 2)

    def test_invalid_values_fail_without_corrupting_outputs(self):
        with self.assertRaises(ValueError):
            simplify([[0, 0], [math.nan, 1]], 4)
        with self.assertRaises(ValueError):
            simplify([[0, 0], [1, 1]], -1)

    def test_duplicate_points_do_not_change_shape(self):
        line = [[0, 0], [0, 0], [0.001, 0], [0.001, 0]]
        self.assertEqual(simplify(line, 4), [[0, 0], [0.001, 0]])


if __name__ == '__main__':
    unittest.main()
