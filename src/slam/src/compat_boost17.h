#if __cplusplus >= 201703L
namespace std {
    template <class Arg, class Result>
    struct unary_function {
        typedef Arg argument_type;
        typedef Result result_type;
    };
}
#endif 